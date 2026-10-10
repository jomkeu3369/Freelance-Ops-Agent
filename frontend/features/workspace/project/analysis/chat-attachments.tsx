"use client";

import { Check, CircleNotch, FileCsv, FileImage, FilePdf, FileText, Paperclip, X } from "@phosphor-icons/react";
import { ClipboardEvent, useCallback, useEffect, useId, useRef, useState } from "react";
import { useT } from "../../../../app/lib/ui-language";
import { AuthSession, AttachmentPreview, OcrOptions, currentSessionGeneration, readChatAttachment, removeChatAttachment } from "../../../../app/lib/api";
import { attachmentLimits, pastedTextFile, pasteThreshold, validateAttachments } from "./attachment-draft";
import "./chat-attachments.css";

interface DraftFile extends OcrOptions { key: string; file: File; encoding: string; delimiter: string; preview?: AttachmentPreview; }
const drafts = new Map<string, { items: DraftFile[]; expires: number }>();
const ttl = 60 * 60 * 1000;
let draftsGeneration: number | null = null;
function prune() {
  const generation = currentSessionGeneration();
  // Logout can happen while every chat is unmounted. Never restore an older login's files.
  if (draftsGeneration !== generation) { drafts.clear(); draftsGeneration = generation; }
  for (const [key, value] of drafts) if (value.expires <= Date.now()) drafts.delete(key);
}

export function useChatAttachments(session: AuthSession, projectId: string) {
  const key = `${session.userId}:${session.workspaceId}:${projectId}`;
  const [items, setItems] = useState<DraftFile[]>(() => { prune(); return drafts.get(key)?.items ?? []; });
  const [error, setError] = useState("");
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const current = useRef(items);
  const mounted = useRef(true);
  const expire = useCallback(() => {
    prune();
    if (!drafts.has(key) && current.current.length && !abort.current) {
      current.current = []; setItems([]); setConfirmed(false); setReviewOpen(false); setFailedKey(null);
      setError("첨부 초안이 1시간 만료되었습니다. 원본 파일을 다시 선택해 주세요.");
      return true;
    }
    return false;
  }, [key]);
  function update(next: DraftFile[]) {
    current.current = next;
    drafts.set(key, { items: next, expires: Date.now() + ttl });
    if (mounted.current) { setItems(next); setConfirmed(false); if (!next.length) setReviewOpen(false); }
  }
  useEffect(() => {
    mounted.current = true;
    const clear = () => { drafts.clear(); abort.current?.abort(); current.current = []; setItems([]); setReviewOpen(false); setFailedKey(null); };
    window.addEventListener("freelance-ops-session-cleared", clear);
    const timer = setInterval(expire, 30000);
    return () => { mounted.current = false; abort.current?.abort(); clearInterval(timer); window.removeEventListener("freelance-ops-session-cleared", clear); };
  }, [key, expire]);
  function add(files: File[]) {
    try {
      const expired = expire();
      validateAttachments(current.current.map(item => item.file), files);
      const others = [...drafts].filter(([entry]) => entry !== key).flatMap(([, value]) => value.items);
      if (others.length + current.current.length + files.length > 12) throw new Error("다른 프로젝트의 미전송 첨부를 먼저 제거해 주세요.");
      update([...current.current, ...files.map(file => ({ key: crypto.randomUUID(), file, encoding: "auto", delimiter: "auto", ocrLanguage: "mixed" as const, ocrLayout: "general" as const }))]);
      if (!expired) setError("");
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
    if (expire()) return;
    if (failedKey === item.key) { setFailedKey(null); setError(""); }
    update(current.current.filter(value => value.key !== item.key));
    if (item.preview) void removeChatAttachment(session, projectId, item.preview.id).catch(() => setError("임시 첨부 삭제를 확인하지 못했습니다. 서버 자료는 30분 후 만료됩니다."));
  }
  function options(item: DraftFile, encoding: string, delimiter: string, ocrLanguage = item.ocrLanguage, ocrLayout = item.ocrLayout) {
    if (abort.current || expire()) return;
    if (failedKey === item.key) { setFailedKey(null); setError(""); }
    if (item.preview) void removeChatAttachment(session, projectId, item.preview.id).catch(() => {});
    update(current.current.map(value => value.key === item.key ? { ...value, encoding, delimiter, ocrLanguage, ocrLayout, preview: undefined } : value));
  }
  async function prepare(): Promise<boolean> {
    // Background tabs can delay timers. Expiry must also gate explicit user actions.
    if (abort.current || expire()) return false;
    const pending = current.current.filter(item => !item.preview);
    if (!pending.length) return !current.current.length || confirmed;
    setReviewOpen(true);
    const controller = new AbortController();
    abort.current = controller;
    setReading(true); setError(""); setFailedKey(null);
    let readingKey: string | null = null;
    try {
      for (const item of pending) {
        readingKey = item.key;
        const preview = await readChatAttachment(session, projectId, item.file, item.encoding, item.delimiter, controller.signal, { ocrLanguage: item.ocrLanguage, ocrLayout: item.ocrLayout });
        if (controller.signal.aborted || !mounted.current || abort.current !== controller) {
          void removeChatAttachment(session, projectId, preview.id).catch(() => {});
          return false;
        }
        update(current.current.map(value => value.key === item.key ? { ...value, preview } : value));
      }
      return false; // Review coverage and confirm before the next Send; never auto-send after extraction.
    } catch (cause) {
      if (mounted.current && !controller.signal.aborted) setFailedKey(readingKey);
      if (mounted.current) setError(controller.signal.aborted ? "파일 읽기를 취소했습니다. 원본 첨부는 보존되었습니다." : cause instanceof Error ? cause.message : "파일을 읽지 못했습니다.");
      return false;
    } finally { abort.current = null; if (mounted.current) setReading(false); }
  }
  const ready = items.every(item => item.preview);
  const tooLarge = items.reduce((sum, item) => sum + Array.from(item.preview?.extraction.text ?? "").length, 0) > attachmentLimits.text;
  const currentError = error || (tooLarge ? "총 추출량은 40,000자 이하여야 합니다. 일부 첨부를 제거해 주세요." : "");
  return { items, reading, error: currentError, failedKey, add, paste, remove, options, prepare, confirmed, setConfirmed, ready, tooLarge, reviewOpen, setReviewOpen,
    ids: items.flatMap(item => item.preview ? [item.preview.id] : []),
    clear: () => { update([]); setReviewOpen(false); setFailedKey(null); drafts.delete(key); }, cancel: () => abort.current?.abort() };
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

/** The picker stays in the toolbar; review and extraction remain above the draft. */
export function ChatAttachmentButton({ state, disabled }: { state: ReturnType<typeof useChatAttachments>; disabled: boolean }) {
  const t = useT();
  const picker = useRef<HTMLInputElement>(null);
  const id = useId();
  const [hint, setHint] = useState(false);
  return <span className="chat-attachment-control" onPointerEnter={event => { if (event.pointerType === "mouse") setHint(true); }} onPointerLeave={() => setHint(false)}>
    <input ref={picker} type="file" multiple accept=".txt,.csv,.pdf,.jpg,.jpeg,.png,.gif" aria-label={t("첨부파일 선택")} hidden disabled={disabled || state.reading}
      onChange={event => { state.add(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
    <button type="button" className="quiet-button chat-attachment-trigger" aria-label={t("파일 첨부")} aria-describedby={hint ? id : undefined} disabled={disabled || state.reading}
      onFocus={event => { if (event.currentTarget.matches(":focus-visible")) setHint(true); }} onBlur={() => setHint(false)}
      onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); setHint(false); } }}
      onClick={() => { setHint(false); picker.current?.click(); }}><Paperclip size={20} aria-hidden="true" /></button>
    {hint && <span id={id} role="tooltip" className="chat-settings-tooltip">{t("파일 첨부")}</span>}
  </span>;
}

function attachmentStatus(item: DraftFile, confirmed: boolean, reading: boolean) {
  if (!item.preview) return reading ? "읽는 중" : "아직 읽지 않음";
  if (item.preview.extraction.status === "PARTIAL") return "일부 읽음";
  if (item.preview.extraction.status !== "COMPLETE") return "내용 읽기 미지원";
  return confirmed ? "확인 완료" : "확인 필요";
}

export function ChatAttachments({ state, disabled }: { state: ReturnType<typeof useChatAttachments>; disabled: boolean }) {
  const t = useT();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const id = useId();
  const visible = state.reviewOpen && state.items.length > 0;
  function closeReview() {
    state.setReviewOpen(false);
    // Removing the originating file must not leave keyboard focus on the body.
    (trigger.current?.isConnected ? trigger.current : root.current?.querySelector<HTMLButtonElement>(".chat-attachment-tile"))?.focus();
  }
  function removeFile(item: DraftFile) {
    const cards = root.current?.querySelectorAll<HTMLButtonElement>(".chat-attachment-tile");
    const index = state.items.findIndex(value => value.key === item.key);
    const next = cards?.[index + 1] ?? cards?.[index - 1] ?? root.current?.closest("form")?.querySelector<HTMLTextAreaElement>("textarea");
    state.remove(item);
    next?.focus();
  }
  return <div className="chat-attachments" ref={root}>
    {state.items.length > 0 && <ul className="chat-attachment-tiles" aria-label={t("첨부파일")}>
      {state.items.map(item => {
        const pdf = /\.pdf$/i.test(item.file.name);
        const Icon = pdf ? FilePdf : /\.csv$/i.test(item.file.name) ? FileCsv : /\.(jpe?g|png|gif)$/i.test(item.file.name) ? FileImage : FileText;
        const failed = state.failedKey === item.key;
        const status = failed ? "읽기 실패" : attachmentStatus(item, state.confirmed, state.reading);
        return <li key={item.key} className="chat-attachment-card">
          <button type="button" className="chat-attachment-tile" aria-label={t("{v0} 상세 보기", { v0: item.file.name })}
            aria-expanded={visible} aria-controls={visible ? id : undefined} aria-describedby={`${id}-${item.key}`} title={item.file.name}
            onClick={event => { trigger.current = event.currentTarget; state.setReviewOpen(true); }}>
            <Icon size={30} className={pdf ? "attachment-file-icon pdf" : "attachment-file-icon"} aria-hidden="true" />
            <span className="attachment-file-name">{item.file.name}</span>
            <span id={`${id}-${item.key}`} className={state.reading || failed || item.preview && (!state.confirmed || item.preview.extraction.status !== "COMPLETE") ? "attachment-tile-status" : "sr-only"} data-status={failed ? "FAILED" : item.preview?.extraction.status ?? "UNREAD"}>
              {state.reading && !item.preview ? <CircleNotch size={12} className="spin" aria-hidden="true" /> : state.confirmed && item.preview?.extraction.status === "COMPLETE" ? <Check size={12} aria-hidden="true" /> : null}{t(status)}
            </span>
          </button>
          <button type="button" className="chat-attachment-remove" disabled={disabled || state.reading} onClick={() => removeFile(item)} aria-label={t("{v0} 제거", { v0: item.file.name })}><X size={17} aria-hidden="true" /></button>
        </li>;
      })}
    </ul>}
    {visible && <AttachmentReview id={id} state={state} disabled={disabled} onClose={closeReview} />}
    {state.reading && <button type="button" className="chat-attachment-cancel" onClick={state.cancel}>{t("파일 읽기 취소")}</button>}
    {state.error && <p role="alert">{t(state.error)}</p>}
  </div>;
}

function AttachmentReview({ id, state, disabled, onClose }: { id: string; state: ReturnType<typeof useChatAttachments>; disabled: boolean; onClose: () => void }) {
  const t = useT();
  const close = useRef<HTMLButtonElement>(null);
  const region = useRef<HTMLElement>(null);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const previewItem = state.items.find(item => item.key === previewKey);
  useEffect(() => { close.current?.focus(); }, []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && region.current?.contains(document.activeElement)) {
        event.preventDefault(); event.stopPropagation(); onClose();
      }
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [onClose]);
  return <section ref={region} id={id} className="chat-attachment-review" aria-label={t("첨부파일 상세")}>
    <div className="chat-attachment-review-heading"><strong>{t("첨부파일 상세")}</strong><button ref={close} type="button" onClick={onClose} aria-label={t("첨부파일 상세 닫기")}><X size={18} aria-hidden="true" /></button></div>
      <p className="agent-chat-muted">{t("원본은 전송 전 이 브라우저 메모리에만 보관됩니다. 새로고침하면 사라집니다. 파일당 2 MiB · 합계 8 MiB · 6개 · 추출 합계 40,000자.")}</p>
      <div className="chat-attachment-review-files">{state.items.map(item => <article key={item.key}>
        <strong>{item.file.name}</strong> <small>{item.file.size.toLocaleString()} B</small>
        <span>{t(!item.preview ? "아직 읽지 않음" : item.preview.extraction.status === "COMPLETE" ? "텍스트 추출 완료" : item.preview.extraction.status === "PARTIAL" ? "일부 읽음 · 문자 인식 결과 확인 필요" : "내용 읽기 미지원")}</span>
        {/\.(txt|csv)$/i.test(item.file.name) && <>
          <label>{t("인코딩")}<select disabled={disabled || state.reading} value={item.encoding} onChange={event => state.options(item, event.target.value, item.delimiter)}>{["auto", "utf-8", "utf-16", "cp949"].map(value => <option key={value} value={value}>{value === "auto" ? t("자동") : value}</option>)}</select></label>
          <button type="button" onClick={() => setPreviewKey(item.key)}>{t("로컬 TXT 확인")}</button>
        </>}
        {/\.csv$/i.test(item.file.name) && <label>{t("구분자")}<select disabled={disabled || state.reading} value={item.delimiter} onChange={event => state.options(item, item.encoding, event.target.value)}>{[["auto", "자동"], [",", "쉼표"], [";", "세미콜론"], ["\t", "탭"], ["|", "파이프"]].map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label>}
        {/\.(pdf|jpe?g|png|gif)$/i.test(item.file.name) && <>
          <label>{t("문자 인식 언어")}<select disabled={disabled || state.reading} value={item.ocrLanguage} onChange={event => state.options(item, item.encoding, item.delimiter, event.target.value as OcrOptions["ocrLanguage"])}>{[["mixed", "한국어 + 영어"], ["ko", "한국어"], ["en", "영어"]].map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label>
          <label>{t("문서 형태")}<select disabled={disabled || state.reading} value={item.ocrLayout} onChange={event => state.options(item, item.encoding, item.delimiter, item.ocrLanguage, event.target.value as OcrOptions["ocrLayout"])}>{[["general", "일반 문서"], ["singleblock", "한 덩어리 텍스트"]].map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label>
          <small>{t("언어를 자동 감지하지 않습니다. 형태에 따라 결과가 달라질 수 있습니다.")}</small>
        </>}
        {item.preview && <details><summary>{t("읽기 결과 확인")}</summary><p>{item.preview.extraction.notice || t(item.preview.extraction.status === "COMPLETE" ? "텍스트를 잘라내지 않고 추출했습니다." : "일부 읽음 · 문자 인식 결과 확인 필요")}</p><p>{item.preview.extraction.encoding} · {t("{v0} 페이지/행/프레임 · {v1}자", { v0: item.preview.extraction.units, v1: Array.from(item.preview.extraction.text).length.toLocaleString() })}</p>
          {!!item.preview.extraction.coverage?.length && <div className="attachment-coverage"><table><caption>{t("페이지·프레임 읽기 범위")}</caption><thead><tr>{["위치", "기존 텍스트", "OCR 시도", "OCR 완료", "결과·사유"].map(label => <th key={label} scope="col">{t(label)}</th>)}</tr></thead><tbody>{item.preview.extraction.coverage.map(unit => <tr key={unit.index}>
            <th scope="row">{t(unit.kind === "PAGE" ? "페이지 {v0}" : "프레임 {v0}", { v0: unit.index })}</th>
            <td>{t(unit.nativeStatus === "TEXT" ? "있음" : unit.nativeStatus === "FAILED" ? "읽기 실패" : unit.nativeStatus === "EMPTY" ? "없음" : "해당 없음")}</td>
            <td>{t(unit.ocrAttempted ? "시도함" : "시도 안 함")}</td><td>{t(unit.ocrCompleted ? "완료" : "미완료")}</td>
            <td>{t(coverageReasons[unit.reason])}{unit.rasterStatus === "UNKNOWN" && <> · {t("이미지 탐색 한계")}</>}</td>
          </tr>)}</tbody></table></div>}
          <pre>{item.preview.extraction.text || t("추출한 텍스트 없음")}</pre></details>}
      </article>)}</div>
      {state.ready && <label><input type="checkbox" checked={state.confirmed} disabled={disabled || state.tooLarge} onChange={event => state.setConfirmed(event.target.checked)} />{t("읽은 범위와 누락·미지원 내용을 확인했습니다. 첨부 텍스트가 대화 기록에 저장됩니다.")}</label>}
      {state.ready && <p className="agent-chat-muted">{t("임시 결과는 30분 후 만료됩니다. 만료 오류가 나면 제거 후 다시 첨부해 주세요. 보낸 내용은 프로젝트 대화의 보존·삭제 정책을 따릅니다.")}</p>}
    {previewItem && <LocalTextPreview key={previewItem.key} file={previewItem.file} onClose={() => setPreviewKey(null)} />}
  </section>;
}

const coverageReasons = {
  TEXT_ONLY: "기존 텍스트만 읽음", SMALL_RASTER: "작은 이미지 OCR 생략", SAMPLED_OUT: "3개 샘플 제한으로 생략",
  BUDGET_EXHAUSTED: "OCR 시간 한도", TOOL_UNAVAILABLE: "OCR 도구 없음", LANGUAGE_UNAVAILABLE: "요청 언어팩 없음",
  TOOL_FAILED: "OCR 읽기 실패", EMPTY_RESULT: "OCR 텍스트 없음", TEXT_FOUND: "OCR 텍스트 읽음", DUPLICATE_ONLY: "기존 텍스트와 중복",
};
