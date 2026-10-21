import { useEffect, useRef, useState, type FormEvent, type Dispatch, type SetStateAction } from "react";
import { Folder, FolderOpen, FolderPlus, PencilSimple, Trash, Warning, CheckCircle, CircleNotch, CaretRight } from "@phosphor-icons/react";
import { AuthSession, RateCard, RateCardFolder, listRateCardFolders, saveRateCardFolder, deleteRateCardFolder } from "../../../app/lib/api";
import { useT } from "../../../app/lib/ui-language";
import { RateCardManager } from "./rate-card-manager";
import { rateCardFolderOptions, rateCardFolderPath } from "./rate-card-folders";

function folderError(cause: unknown, fallback: string) {
  const message = cause instanceof Error ? cause.message : fallback;
  if (message.includes("a folder with this name already exists")) return "같은 위치에 같은 이름의 폴더가 있습니다.";
  if (message.includes("only empty folders can be deleted")) return "단가나 하위 폴더를 먼저 옮긴 뒤 삭제해 주세요.";
  if (message.includes("cannot be moved into itself or its descendants")) return "자신이나 하위 폴더 안으로 이동할 수 없습니다.";
  if (message.includes("folder changed; reload and try again")) return "폴더가 변경되었습니다. 다시 불러온 뒤 시도해 주세요.";
  if (message.includes("folder name must contain")) return "폴더 이름은 1~120자의 일반 문자로 입력해 주세요.";
  if (message.includes("at most 200 rate-card folders")) return "이 작업 공간에는 폴더를 최대 200개까지 만들 수 있습니다.";
  if (message.includes("nested at most 8 levels")) return "폴더는 루트를 포함해 최대 8단계까지 중첩할 수 있습니다.";
  return message;
}

interface RateCardLibraryProps {
  session: AuthSession;
  rateCards: RateCard[];
  canWrite: boolean;
  onChange: Dispatch<SetStateAction<RateCard[]>>;
}

export function RateCardLibrary({ session, rateCards, canWrite, onChange }: RateCardLibraryProps) {
  const t = useT();
  const [folders, setFolders] = useState<RateCardFolder[]>([]);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [cardBusy, setCardBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [navigation, setNavigation] = useState<{ id: string | null } | null>(null);
  const [editing, setEditing] = useState<"new" | "edit" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const revision = useRef(0);
  const pending = useRef(false);
  const newFolderId = useRef<string | null>(null);
  const location = useRef<HTMLElement>(null);
  const locationMounted = useRef(false);
  const current = folders.find((folder) => folder.id === folderId);
  const missingFolder = folderId !== null && !current && !loading && !loadError;
  const children = folders.filter((folder) => folder.parentId === folderId).sort((left, right) => left.name.localeCompare(right.name, "ko"));
  const path = rateCardFolderPath(folders, folderId);
  const locked = busy || cardBusy;

  useEffect(() => {
    if (!locationMounted.current) { locationMounted.current = true; return; }
    location.current?.querySelector<HTMLButtonElement>("button[aria-current]")?.focus({ preventScroll: true });
    location.current?.scrollIntoView({ block: "start", behavior: "instant" });
  }, [folderId]);

  useEffect(() => {
    let cancelled = false;
    const atStart = revision.current;
    listRateCardFolders(session).then((value) => {
      if (cancelled || atStart !== revision.current) return;
      setFolders(value);
      setLoadError(null);
    }).catch((cause) => {
      if (!cancelled && atStart === revision.current) setLoadError(cause instanceof Error ? cause.message : "폴더를 불러오지 못했습니다.");
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [session, retry]);

  function navigate(id: string | null) {
    if (locked || pending.current || id === folderId) return;
    if (dirty) { setNavigation({ id }); return; }
    setFolderId(id);
    setEditing(null);
    setError(null);
    setNotice(null);
  }

  function openEditor(mode: "new" | "edit") {
    if (locked || pending.current) return;
    newFolderId.current = null;
    setEditing(mode);
    setConfirmDelete(false);
    setError(null);
    setNotice(null);
  }

  async function saveFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canWrite || locked || pending.current) return;
    if (editing === "edit" && !current) { setError("삭제된 폴더는 수정할 수 없습니다. 취소 후 다른 폴더를 선택해 주세요."); return; }
    const data = new FormData(event.currentTarget);
    const name = String(data.get("folderName") ?? "").trim();
    if (!name) { setError("폴더 이름을 입력해 주세요."); return; }
    pending.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const id = editing === "edit" && current ? current.id : (newFolderId.current ??= crypto.randomUUID());
      const saved = await saveRateCardFolder(session, id, { name, parentId: String(data.get("parentId") ?? "") || null });
      revision.current += 1;
      setFolders((values) => [...values.filter((folder) => folder.id !== saved.id), saved]);
      setEditing(null);
      setNotice("폴더를 저장했습니다.");
    } catch (cause) {
      setError(folderError(cause, "폴더를 저장하지 못했습니다."));
    } finally { pending.current = false; setBusy(false); }
  }

  async function removeFolder() {
    if (!canWrite || !current || locked || pending.current || dirty) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await deleteRateCardFolder(session, current.id);
      revision.current += 1;
      setFolders((values) => values.filter((folder) => folder.id !== current.id));
      setFolderId(current.parentId);
      setEditing(null);
      setConfirmDelete(false);
      setNotice("빈 폴더를 삭제했습니다.");
    } catch (cause) {
      setError(folderError(cause, "폴더를 삭제하지 못했습니다."));
    } finally { pending.current = false; setBusy(false); }
  }

  return (
    <div className="rate-card-library">
      <div className="rate-folder-heading">
        <div><FolderOpen size={22} aria-hidden="true" /><p>{t("폴더로 단가를 정리하고 필요한 항목만 확인하세요.")}</p></div>
        {canWrite && <button type="button" className="secondary-button" disabled={locked || loading || Boolean(loadError) || missingFolder} onClick={() => openEditor("new")}><FolderPlus size={18} aria-hidden="true" />{t(folderId ? "하위 폴더 추가" : "폴더 추가")}</button>}
      </div>
      {loading && <p role="status"><CircleNotch size={18} className="spin" aria-hidden="true" />{t("폴더를 불러오고 있습니다.")}</p>}
      {loadError && <div className="inline-error" role="alert"><Warning size={18} aria-hidden="true" /><span>{t("폴더를 불러오지 못했습니다.")}</span><button type="button" className="secondary-button" disabled={locked} onClick={() => setRetry((value) => value + 1)}>{t("다시 시도")}</button></div>}
      {error && <div className="inline-error" role="alert"><Warning size={18} aria-hidden="true" />{t(error)}</div>}
      {notice && <div className="settings-saved" role="status"><CheckCircle size={18} aria-hidden="true" />{t(notice)}</div>}
      {missingFolder && <p className="permission-note" role="status">{t("다른 곳에서 이 폴더를 삭제했습니다. 입력 중인 단가는 유지되며 저장하면 미분류에 등록됩니다.")}</p>}
      {!loading && !loadError && <>
        <div className="rate-folder-location">
          <nav ref={location} className="rate-folder-breadcrumb" aria-label={t("단가 폴더 경로")}>
            <button type="button" disabled={locked || Boolean(editing)} aria-current={!folderId ? "page" : undefined} onClick={() => navigate(null)}>{t("전체 폴더")}</button>
            {path.map((folder) => <span key={folder.id}><CaretRight size={15} aria-hidden="true" /><button type="button" disabled={locked || Boolean(editing)} aria-current={folder.id === folderId ? "page" : undefined} onClick={() => navigate(folder.id)}>{folder.name}</button></span>)}
          </nav>
          {canWrite && current && <button type="button" className="secondary-button" disabled={locked} onClick={() => openEditor("edit")}><PencilSimple size={17} aria-hidden="true" />{t("폴더 관리")}</button>}
        </div>
        {navigation && <div className="rate-folder-confirm" role="alert">
          <p>{t("저장하지 않은 단가 변경이 있습니다. 다른 폴더로 이동할까요?")}</p>
          <button type="button" className="secondary-button" disabled={locked} onClick={() => setNavigation(null)}>{t("계속 편집")}</button>
          <button type="button" className="secondary-button" disabled={locked} onClick={() => { if (locked || pending.current) return; setFolderId(navigation.id); setDirty(false); setNavigation(null); setEditing(null); setError(null); setNotice(null); }}>{t("변경 버리고 이동")}</button>
        </div>}
        {editing && <form className="rate-folder-form" key={`${editing}:${folderId}`} onSubmit={saveFolder} aria-label={t(editing === "new" ? "폴더 추가" : "폴더 관리")} aria-busy={busy}>
          <fieldset disabled={locked}>
            <label>{t("폴더 이름")}<input name="folderName" maxLength={120} required defaultValue={editing === "edit" ? current?.name : ""} /></label>
            <label>{t("상위 폴더")}<select name="parentId" aria-label={t("상위 폴더")} defaultValue={(editing === "edit" ? current?.parentId : folderId) ?? ""}>
              <option value="">{t("전체 폴더")}</option>
              {rateCardFolderOptions(folders, editing === "edit" ? folderId ?? undefined : undefined).map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
            </select></label>
          </fieldset>
          <p className="rate-folder-limits">{t("폴더는 작업 공간당 200개, 루트를 포함해 8단계까지 만들 수 있습니다.")}</p>
          <div className="rate-folder-actions">
            <button type="submit" className="primary-button" disabled={locked || (editing === "edit" && !current)}>{busy ? <CircleNotch size={17} className="spin" aria-hidden="true" /> : <CheckCircle size={17} aria-hidden="true" />}{t("폴더 저장")}</button>
            <button type="button" className="secondary-button" disabled={locked} onClick={() => { setEditing(null); setConfirmDelete(false); setError(null); }}>{t("취소")}</button>
            {editing === "edit" && <button type="button" className="secondary-button" disabled={locked || dirty} onClick={() => setConfirmDelete(true)}><Trash size={17} aria-hidden="true" />{t("폴더 삭제")}</button>}
          </div>
          {confirmDelete && <div className="rate-folder-confirm" role="alert"><p>{t("빈 폴더만 삭제할 수 있습니다. 이 폴더를 삭제할까요?")}</p><button type="button" className="secondary-button" disabled={locked} onClick={() => setConfirmDelete(false)}>{t("취소")}</button><button type="button" className="secondary-button" disabled={locked} onClick={removeFolder}>{t("삭제 확인")}</button></div>}
        </form>}
        {children.length > 0 && <div className="rate-folder-list" role="region" aria-label={t("하위 단가 폴더")}>
          {children.map((folder) => <button type="button" key={folder.id} disabled={locked || Boolean(editing)} onClick={() => navigate(folder.id)}>
            <Folder size={25} aria-hidden="true" /><strong>{folder.name}</strong>
            <small>{t("폴더 {folders}개 · 단가 {rates}개", { folders: folders.filter((child) => child.parentId === folder.id).length, rates: rateCards.filter((card) => card.folderId === folder.id).length })}</small><CaretRight size={17} aria-hidden="true" />
          </button>)}
        </div>}
      </>}
      <fieldset className="rate-card-library-fields" disabled={busy || loading || Boolean(loadError)}>
        <legend>{folderId ? current?.name ?? t("삭제된 폴더") : t("미분류 단가")}</legend>
        <RateCardManager
          key={folderId ?? "root"}
          session={session}
          rateCards={rateCards.filter((card) => (card.folderId ?? null) === folderId)}
          canWrite={canWrite}
          onChange={onChange}
          folders={folders}
          folderId={folderId}
          onDirtyChange={setDirty}
          onPendingChange={setCardBusy}
        />
      </fieldset>
    </div>
  );
}
