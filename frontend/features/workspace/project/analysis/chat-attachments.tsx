"use client";

import { ClipboardEvent, useEffect, useRef, useState } from "react";
import { useT } from "../../../../app/lib/ui-language";
import { AuthSession, AttachmentPreview, readChatAttachment, removeChatAttachment } from "../../../../app/lib/api";
import { attachmentLimits, pastedTextFile, pasteThreshold, validateAttachments } from "./attachment-draft";
import "./chat-attachments.css";

interface DraftFile { key: string; file: File; encoding: string; delimiter: string; preview?: AttachmentPreview; }
const drafts = new Map<string, { items: DraftFile[]; expires: number }>();
const ttl = 60 * 60 * 1000;
function prune() { for (const [key, value] of drafts) if (value.expires <= Date.now()) drafts.delete(key); }

export function useChatAttachments(session: AuthSession, projectId: string) {
  const key = `${session.userId}:${session.workspaceId}:${projectId}`;
  const [items, setItems] = useState<DraftFile[]>(() => { prune(); return drafts.get(key)?.items ?? []; });
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const current = useRef(items);
  const mounted = useRef(true);
  function update(next: DraftFile[]) {
    current.current = next;
    drafts.set(key, { items: next, expires: Date.now() + ttl });
    if (mounted.current) { setItems(next); setConfirmed(false); }
  }
  useEffect(() => {
    mounted.current = true;
    const clear = () => { drafts.clear(); abort.current?.abort(); current.current = []; setItems([]); };
    window.addEventListener("freelance-ops-session-cleared", clear);
    const timer = setInterval(() => {
      prune();
      if (!drafts.has(key) && current.current.length && !abort.current) {
        current.current = []; setItems([]); setError("첨부 초안이 1시간 만료되었습니다. 원본 파일을 다시 선택해 주세요.");
      }
    }, 30000);
    return () => { mounted.current = false; abort.current?.abort(); clearInterval(timer); window.removeEventListener("freelance-ops-session-cleared", clear); };
  }, [key]);
  function add(files: File[]) {
    try {
      prune();
      validateAttachments(current.current.map(item => item.file), files);
      const others = [...drafts].filter(([entry]) => entry !== key).flatMap(([, value]) => value.items);
      if (others.length + current.current.length + files.length > 12) throw new Error("다른 프로젝트의 미전송 첨부를 먼저 제거해 주세요.");
      update([...current.current, ...files.map(file => ({ key: crypto.randomUUID(), file, encoding: "auto", delimiter: "auto" }))]);
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "파일을 추가하지 못했습니다."); }
  }
  function paste(event: ClipboardEvent<HTMLTextAreaElement>, composing: boolean, disabled: boolean) {
    if (disabled || composing) return;
    if (event.clipboardData.files.length) { event.preventDefault(); add(Array.from(event.clipboardData.files)); return; }
    const text = event.clipboardData.getData("text/plain");
    const field = event.currentTarget;
    const remaining = 50000 - (field.value.length - (field.selectionEnd - field.selectionStart));
    const file = pastedTextFile(text, pasteThreshold(process.env.NEXT_PUBLIC_CHAT_PASTE_THRESHOLD), remaining);
    if (file) { event.preventDefault(); add([file]); }
  }
  function remove(item: DraftFile) {
    update(current.current.filter(value => value.key !== item.key));
    if (item.preview) void removeChatAttachment(session, projectId, item.preview.id).catch(() => setError("임시 첨부 삭제를 확인하지 못했습니다. 서버 자료는 30분 후 만료됩니다."));
  }
  function options(item: DraftFile, encoding: string, delimiter: string) {
    if (item.preview) void removeChatAttachment(session, projectId, item.preview.id).catch(() => {});
    update(current.current.map(value => value.key === item.key ? { ...value, encoding, delimiter, preview: undefined } : value));
  }
  async function prepare(): Promise<boolean> {
    if (abort.current) return false;
    const pending = current.current.filter(item => !item.preview);
    if (!pending.length) return !current.current.length || confirmed;
    const controller = new AbortController();
    abort.current = controller;
    setReading(true); setError("");
    try {
      for (const item of pending) {
        const preview = await readChatAttachment(session, projectId, item.file, item.encoding, item.delimiter, controller.signal);
        if (controller.signal.aborted || !mounted.current) return false;
        update(current.current.map(value => value.key === item.key ? { ...value, preview } : value));
      }
      const characters = current.current.reduce((sum, item) => sum + Array.from(item.preview?.extraction.text ?? "").length, 0);
      if (characters > attachmentLimits.text) setError("총 추출량은 40,000자 이하여야 합니다. 일부 첨부를 제거해 주세요.");
      return false; // Review coverage and confirm before the next Send; never auto-send after extraction.
    } catch (cause) {
      if (mounted.current) setError(controller.signal.aborted ? "파일 읽기를 취소했습니다. 원본 첨부는 보존되었습니다." : cause instanceof Error ? cause.message : "파일을 읽지 못했습니다.");
      return false;
    } finally { abort.current = null; if (mounted.current) setReading(false); }
  }
  const ready = items.every(item => item.preview);
  const tooLarge = items.reduce((sum, item) => sum + Array.from(item.preview?.extraction.text ?? "").length, 0) > attachmentLimits.text;
  return { items, reading, error, add, paste, remove, options, prepare, confirmed, setConfirmed, ready, tooLarge,
    ids: items.flatMap(item => item.preview ? [item.preview.id] : []),
    clear: () => { update([]); drafts.delete(key); }, cancel: () => abort.current?.abort() };
}

function LocalTextPreview({ file, onClose }: { file: File; onClose: () => void }) {
  const t = useT();
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    void file.text().then(value => { if (active) setText(value); }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [file]);
  return <div>
    <button type="button" onClick={onClose}>{t("미리보기 닫기")}</button>
    {failed && <p role="alert">{t("파일을 읽지 못했습니다.")}</p>}
    {text !== null && <pre>{text.length > 40000 ? `${text.slice(0, 40000)}\n${t("[미리보기만 40,000자로 제한됨. 원본은 유지됩니다.]")}` : text}</pre>}
  </div>;
}

export function ChatAttachments({ state, disabled }: { state: ReturnType<typeof useChatAttachments>; disabled: boolean }) {
  const t = useT();
  const picker = useRef<HTMLInputElement>(null);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const previewItem = state.items.find(item => item.key === previewKey);
  return <div className="chat-attachments">
    <input ref={picker} type="file" multiple accept=".txt,.csv,.pdf,.jpg,.jpeg,.png,.gif" aria-label={t("첨부파일 선택")} hidden
      onChange={event => { state.add(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
    <button type="button" className="quiet-button" disabled={disabled || state.reading} onClick={() => picker.current?.click()}>{t("파일 첨부")}</button>
    <small>{t("TXT·CSV·PDF · JPG·PNG·GIF·스캔은 무료 문자 인식(OCR), 그림·움직임 해석 미지원")}</small>
    {state.items.length > 0 && <>
      <p className="agent-chat-muted">{t("원본은 전송 전 이 브라우저 메모리에만 보관됩니다. 새로고침하면 사라집니다. 파일당 2 MiB · 합계 8 MiB · 6개 · 추출 합계 40,000자.")}</p>
      <ul>{state.items.map(item => <li key={item.key}>
        <strong>{item.file.name}</strong> <small>{item.file.size.toLocaleString()} B</small>
        <span>{t(!item.preview ? "아직 읽지 않음" : item.preview.extraction.status === "COMPLETE" ? "텍스트 추출 완료" : item.preview.extraction.status === "PARTIAL" ? "일부 읽음 · 문자 인식 결과 확인 필요" : "내용 읽기 미지원")}</span>
        <button type="button" disabled={disabled || state.reading} onClick={() => state.remove(item)} aria-label={t("{v0} 제거", { v0: item.file.name })}>{t("제거")}</button>
        {/\.(txt|csv)$/i.test(item.file.name) && <>
          <label>{t("인코딩")}<select disabled={disabled || state.reading} value={item.encoding} onChange={event => state.options(item, event.target.value, item.delimiter)}>{["auto", "utf-8", "utf-16", "cp949"].map(value => <option key={value} value={value}>{value === "auto" ? t("자동") : value}</option>)}</select></label>
          <button type="button" onClick={() => setPreviewKey(item.key)}>{t("로컬 TXT 확인")}</button>
        </>}
        {/\.csv$/i.test(item.file.name) && <label>{t("구분자")}<select disabled={disabled || state.reading} value={item.delimiter} onChange={event => state.options(item, item.encoding, event.target.value)}>{[["auto", "자동"], [",", "쉼표"], [";", "세미콜론"], ["\t", "탭"], ["|", "파이프"]].map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label>}
        {item.preview && <details><summary>{t("읽기 결과 확인")}</summary><p>{item.preview.extraction.notice || t(item.preview.extraction.status === "COMPLETE" ? "텍스트를 잘라내지 않고 추출했습니다." : "일부 읽음 · 문자 인식 결과 확인 필요")}</p><p>{item.preview.extraction.encoding} · {t("{v0} 페이지/행/프레임 · {v1}자", { v0: item.preview.extraction.units, v1: Array.from(item.preview.extraction.text).length.toLocaleString() })}</p><pre>{item.preview.extraction.text || t("추출한 텍스트 없음")}</pre></details>}
      </li>)}</ul>
      {state.ready && <label><input type="checkbox" checked={state.confirmed} disabled={disabled || state.tooLarge} onChange={event => state.setConfirmed(event.target.checked)} />{t("읽은 범위와 누락·미지원 내용을 확인했습니다. 첨부 텍스트가 대화 기록에 저장됩니다.")}</label>}
      {state.ready && <p className="agent-chat-muted">{t("임시 결과는 30분 후 만료됩니다. 만료 오류가 나면 제거 후 다시 첨부해 주세요. 보낸 내용은 프로젝트 대화의 보존·삭제 정책을 따릅니다.")}</p>}
    </>}
    {state.reading && <button type="button" onClick={state.cancel}>{t("파일 읽기 취소")}</button>}
    {state.error && <p role="alert">{t(state.error)}</p>}
    {previewItem && <LocalTextPreview key={previewItem.key} file={previewItem.file} onClose={() => setPreviewKey(null)} />}
  </div>;
}
