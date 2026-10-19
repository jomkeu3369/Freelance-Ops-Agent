import { useT } from "../../../app/lib/ui-language";
import { useEffect, useId, useRef, useState } from "react";
import { ArrowClockwise, Plus } from "@phosphor-icons/react";
import {
  ApiError,
  listAgentPets,
  generatePixelPet,
  getPixelPetGeneration,
  saveAgentPet,
  changeAgentPet,
  deleteAgentPet,
  type AuthSession,
  type AgentPetCollection,
  type ComposeAgentPet,
  type CustomAgentPet,
  type PetProfile
} from "@/app/lib/api";
import { beginPetMutation, petLibraryRevision, publishPetLibrary } from "./pet-library-events";
import { PetLibrary } from "./pet-library";
import { PetCreationStudio } from "./pet-creation-studio";
import { readPetGeneration, rememberPetGeneration } from "./pet-generation-session";

export function PetCustomizer({
  session,
  projectId,
  disabled
}: {
  session: AuthSession;
  projectId: string;
  disabled: boolean;
}) {
  const t = useT();
  const prefix = useId();
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLElement>(null);
  const selectedPetRef = useRef<HTMLButtonElement>(null);
  const createPetRef = useRef<HTMLButtonElement>(null);
  const refreshPetRef = useRef<HTMLButtonElement>(null);
  const [focusRequest, setFocusRequest] = useState<{ target: "prompt" | "preview" | "selected" | "create" } | null>(
    null
  );
  const pending = useRef(false);
  const pendingGeneration = useRef<ComposeAgentPet | null>(null);
  const generationVersion = useRef(0);
  const resumed = useRef(false);
  const listVersion = useRef(0);
  const [collection, setCollection] = useState<AgentPetCollection | null>(null);
  const [editing, setEditing] = useState<CustomAgentPet | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [resetPreferences, setResetPreferences] = useState(false);
  const [preview, setPreview] = useState<{ input: ComposeAgentPet; profile: PetProfile } | null>(null);
  const [status, setStatus] = useState("");
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [pendingResult, setPendingResult] = useState(false);
  const [reload, setReload] = useState(0);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const owner = `${session.workspaceId}:${session.userId}:${projectId}`;
  useEffect(
    () => () => {
      generationVersion.current += 1;
      pending.current = false;
    },
    [owner]
  );
  useEffect(() => {
    if (!focusRequest) return;
    const target = { prompt: promptRef, preview: previewRef, selected: selectedPetRef, create: createPetRef }[
      focusRequest.target
    ];
    const element = target.current;
    if (element && !element.matches(":disabled")) element.focus();
    else refreshPetRef.current?.focus();
  }, [focusRequest]);
  useEffect(() => {
    let current = true;
    const version = ++listVersion.current;
    const libraryRevision = petLibraryRevision();
    listAgentPets(session)
      .then((value) => {
        if (current && version === listVersion.current) {
          setCollection(value);
          setLoadError("");
          publishPetLibrary(session, value, libraryRevision);
          if (!resumed.current) {
            resumed.current = true;
            const input = readPetGeneration(session, projectId);
            if (input) {
              pendingGeneration.current = input;
              setPendingResult(true);
              setDescription(input.description);
              setResetPreferences(input.resetPreferences);
              setEditing(input.expectedRevision > 0 ? (value.pets.find((pet) => pet.id === input.id) ?? null) : null);
              setEditorOpen(true);
              void runGeneration(input, true);
            }
          }
        }
      })
      .catch(() => {
        if (current && version === listVersion.current) setLoadError("펫을 불러오지 못했습니다. 다시 불러와 주세요.");
      });
    return () => {
      current = false;
      listVersion.current += 1;
    };
    // 조회 뒤 생성 복구는 저장한 ID를 읽기만 하며 새 모델 호출을 시작하지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, reload, projectId]);
  const locked = disabled || busy || !collection;
  const active = collection?.pets.filter((pet) => !pet.archived) ?? [];
  const archived = collection?.pets.filter((pet) => pet.archived) ?? [];
  const atLimit =
    !!collection && (active.length >= collection.maxActivePets || collection.pets.length >= collection.maxStoredPets);
  const fullHistory =
    !!editing && (editing.profile.preferences?.requests.length ?? 0) >= (collection?.maxPreferenceRequests ?? 6);
  const hasDraft = !!description.trim() || !!preview;

  async function perform(action: () => Promise<void>, mutates = false) {
    if (pending.current || locked) return;
    const finishMutation = mutates ? beginPetMutation(session) : null;
    if (mutates && !finishMutation) return;
    pending.current = true;
    setBusy(true);
    setStatus("");
    try {
      await action();
      finishMutation?.(true);
    } catch (error) {
      finishMutation?.(false);
      setStatus(
        error instanceof ApiError && error.status === 409
          ? "다른 변경이나 개수 제한을 확인해 주세요. 입력은 유지됩니다. 목록을 다시 불러온 뒤 수정할 펫을 골라 주세요."
          : "완료하지 못했습니다. 입력은 유지됩니다. 연결과 권한을 확인하고 다시 시도해 주세요."
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  function edit(pet: CustomAgentPet | null) {
    pendingGeneration.current = null;
    setPendingResult(false);
    setEditorOpen(true);
    setEditing(pet);
    setDescription("");
    setPreview(null);
    setStatus("");
    setResetPreferences(false);
    setFocusRequest({ target: "prompt" });
  }

  function backToInput() {
    setPreview(null);
    pendingGeneration.current = null;
    setPendingResult(false);
    rememberPetGeneration(session, projectId, null);
    setStatus("");
    setFocusRequest({ target: "prompt" });
  }

  async function refreshCollection() {
    // 변경 전에 시작한 수동 조회가 변경 후의 최신 목록을 덮어쓰지 않게 한다.
    const version = ++listVersion.current;
    const libraryRevision = petLibraryRevision();
    const value = await listAgentPets(session);
    if (version === listVersion.current) {
      setCollection(value);
      setLoadError("");
    }
    // 헤더는 패널보다 오래 유지된다. 변경 후 조회 중 패널이 닫혀도
    // 확인된 최신 버전은 헤더에 알린다.
    publishPetLibrary(session, value, libraryRevision);
  }

  function makeGeneration() {
    if (locked || pending.current) return;
    const input = pendingGeneration.current ?? {
      id: editing?.id ?? crypto.randomUUID(),
      mutationId: crypto.randomUUID(),
      expectedRevision: editing?.revision ?? 0,
      description,
      resetPreferences
    };
    void runGeneration(input, pendingResult);
  }

  async function runGeneration(input: ComposeAgentPet, resumeOnly = false) {
    if (pending.current) return;
    pending.current = true;
    pendingGeneration.current = input;
    setPendingResult(true);
    rememberPetGeneration(session, projectId, input);
    const version = ++generationVersion.current;
    setBusy(true);
    setGenerating(true);
    setStatus("");
    setFocusRequest({ target: "preview" });
    try {
      let result;
      try {
        result = resumeOnly
          ? await getPixelPetGeneration(session, input.mutationId)
          : await generatePixelPet(session, projectId, input);
      } catch (error) {
        if (resumeOnly) throw error;
        // 응답을 잃었더라도 모델을 다시 호출하지 않고 같은 작업의 결과부터 확인한다.
        result = await getPixelPetGeneration(session, input.mutationId).catch(() => {
          throw error;
        });
      }
      const deadline = Date.now() + (result.status === "UNKNOWN" ? 20_000 : 90_000);
      while ((result.status === "REQUESTED" || result.status === "UNKNOWN") && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        if (version !== generationVersion.current) return;
        result = await getPixelPetGeneration(session, input.mutationId);
      }
      if (version !== generationVersion.current) return;
      if (result.status === "COMPLETED" && result.profile) {
        setPreview({ input: { ...input, generationId: result.id }, profile: result.profile });
        setFocusRequest({ target: "preview" });
      } else {
        if (result.status === "FAILED") {
          pendingGeneration.current = null;
          setPendingResult(false);
          rememberPetGeneration(session, projectId, null);
        }
        setStatus(
          result.status === "FAILED"
            ? "펫을 만들지 못했어요. 설명은 그대로 보관했어요. 다시 생성해 주세요."
            : "생성이 지연되고 있어요. 결과 확인을 누르면 추가 생성 없이 같은 요청을 다시 확인해요."
        );
        setFocusRequest({ target: "prompt" });
      }
    } catch (error) {
      if (version !== generationVersion.current) return;
      if (error instanceof ApiError && [400, 401, 403, 404, 409, 422, 429, 503].includes(error.status)) {
        setPendingResult(false);
      }
      setStatus(
        error instanceof ApiError && error.code === "PLATFORM_SPEND_EXHAUSTED"
          ? "기본 제공 AI 사용량이 부족해요. 사용량이 갱신되면 다시 만들 수 있어요."
          : error instanceof ApiError && error.code === "PLATFORM_SPEND_DISABLED"
            ? "지금은 기본 제공 AI를 사용할 수 없어요. 사용량과 연결 상태를 확인해 주세요."
            : error instanceof ApiError && error.status === 429
              ? "오늘 생성할 수 있는 횟수를 모두 사용했어요. 기존 펫은 계속 사용할 수 있어요."
              : error instanceof ApiError && error.status === 409
                ? "진행 중인 생성이나 펫 개수 제한을 확인해 주세요. 설명은 그대로 보관했어요."
                : error instanceof ApiError && error.status === 404 && resumeOnly
                  ? "이전 생성 결과를 찾지 못했어요. 설명은 그대로예요. 버튼을 눌러 다시 진행해 주세요."
                  : "생성 결과를 확인하지 못했어요. 설명은 그대로예요. 같은 요청의 결과를 다시 확인할 수 있어요."
      );
      setFocusRequest({ target: "prompt" });
    } finally {
      if (version === generationVersion.current) {
        pending.current = false;
        setGenerating(false);
        setBusy(false);
      }
    }
  }

  function save() {
    if (!preview) return;
    void perform(async () => {
      // 응답이 유실돼도 다른 펫을 만들지 않도록 실패 시 변경 요청 ID를 유지한다.
      await saveAgentPet(session, preview.input);
      publishPetLibrary(session, null);
      await refreshCollection();
      setEditing(null);
      setEditorOpen(false);
      setDescription("");
      setPreview(null);
      setFocusRequest({ target: "selected" });
      setResetPreferences(false);
      pendingGeneration.current = null;
      setPendingResult(false);
      rememberPetGeneration(session, projectId, null);
      setStatus("저장하고 선택했습니다. 다음 실행에 이 펫 하나의 선호를 사용합니다.");
    }, true);
  }

  function change(pet: CustomAgentPet, action: "SELECT" | "ARCHIVE" | "RESTORE") {
    void perform(async () => {
      await changeAgentPet(session, pet, action);
      publishPetLibrary(session, null);
      await refreshCollection();
      if (editing?.id === pet.id) {
        setEditing(null);
        setEditorOpen(false);
      }
      setStatus(
        action === "SELECT"
          ? "다음 실행에 사용할 펫을 선택했습니다."
          : action === "ARCHIVE"
            ? "보관했습니다. 이 펫은 다음 실행에 사용하지 않습니다."
            : "펫을 복원했습니다. 사용하려면 선택해 주세요."
      );
    }, true);
  }

  if (editorOpen)
    return (
      <section className="pet-customizer pet-prompt-studio">
        <PetCreationStudio
          prefix={prefix}
          editingName={editing?.profile.name}
          description={description}
          maxLength={collection?.maxPromptLength ?? 500}
          generating={generating}
          saving={busy && !generating}
          locked={locked}
          available={collection?.generationMode === "MODEL_PIXEL" && collection.aiGenerationAvailable}
          atLimit={atLimit}
          profile={preview?.profile ?? null}
          status={status}
          fullHistory={fullHistory}
          resetPreferences={resetPreferences}
          pendingResult={pendingResult}
          promptRef={promptRef}
          stageRef={previewRef}
          onGenerate={makeGeneration}
          onSave={save}
          onEdit={backToInput}
          onDescriptionChange={(value) => {
            if (value !== description) {
              pendingGeneration.current = null;
              setPendingResult(false);
              rememberPetGeneration(session, projectId, null);
            }
            setDescription(value);
            setStatus("");
          }}
          onResetChange={(value) => {
            setResetPreferences(value);
            pendingGeneration.current = null;
            setPendingResult(false);
            rememberPetGeneration(session, projectId, null);
          }}
          onBack={() => {
            setEditorOpen(false);
            setFocusRequest({ target: "create" });
          }}
        />
      </section>
    );

  return (
    <section className="pet-customizer pet-prompt-studio" aria-label={t("함께할 펫 고르기")}>
      <header>
        <div>
          <h3>{t("나의 작은 동료")}</h3>
          <p>{t("다음 작업을 함께할 펫을 골라 주세요.")}</p>
        </div>
        <span className="pet-library-badge">{t("AI 픽셀 펫")}</span>
      </header>
      <div className="pet-library-toolbar">
        <h4>{t("내 펫")}</h4>
        <div>
          <button
            type="button"
            className="pet-library-refresh"
            ref={refreshPetRef}
            disabled={busy || disabled}
            aria-label={t("목록 다시 불러오기")}
            title={t("목록 다시 불러오기")}
            onClick={() => setReload((value) => value + 1)}
          >
            <ArrowClockwise size={17} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="pet-library-create"
            ref={createPetRef}
            disabled={disabled || (!hasDraft && (locked || atLimit))}
            onClick={() => (hasDraft ? setEditorOpen(true) : edit(null))}
          >
            <Plus size={16} aria-hidden="true" />
            {t(hasDraft ? "이어서 만들기" : "펫 만들기")}
          </button>
        </div>
      </div>
      {hasDraft && (
        <div className="pet-library-draft">
          <span>
            {t(
              generating
                ? "펫을 만들고 있어요. 완성되면 확인할 수 있어요."
                : "만들던 펫이 있어요. 이어서 확인하거나 입력을 취소할 수 있어요."
            )}
          </span>
          {!busy && (
            <button
              type="button"
              onClick={() => {
                setDescription("");
                setPreview(null);
                setEditing(null);
                setStatus("");
                pendingGeneration.current = null;
                setPendingResult(false);
                rememberPetGeneration(session, projectId, null);
                setFocusRequest({ target: "create" });
              }}
            >
              {t("입력 취소")}
            </button>
          )}
        </div>
      )}
      {(collection || !loadError) && (
        <PetLibrary
          pets={active}
          selectedId={collection?.selectedPetId ?? null}
          selectedRef={selectedPetRef}
          disabled={locked}
          hasDraft={hasDraft}
          editingId={editing?.id}
          loading={!collection && !loadError}
          onSelect={(pet) => change(pet, "SELECT")}
          onEdit={edit}
          onArchive={(pet) => change(pet, "ARCHIVE")}
        />
      )}
      {collection && collection.pets.length > 0 && (
        <p className="pet-customizer-intro">
          {t("사용 가능")} {active.length}/{collection.maxActivePets} · {t("보관 포함")} {collection.pets.length}/
          {collection.maxStoredPets}
          <br />
          {t("보관하면 사용 가능 수가 줄고, 보관함에서 삭제하면 저장 공간이 늘어납니다.")}
        </p>
      )}
      {archived.length > 0 && (
        <details className="pet-archive">
          <summary>
            {t("보관함")} ({archived.length})
          </summary>
          {archived.map((pet) => (
            <div key={pet.id}>
              <strong>{pet.profile.name}</strong>
              <button
                type="button"
                disabled={locked || !!preview || active.length >= (collection?.maxActivePets ?? 0)}
                onClick={() => change(pet, "RESTORE")}
              >
                {t("복원")}
              </button>
              <button type="button" disabled={locked || !!preview} onClick={() => setDeleteId(pet.id)}>
                {t("삭제")}
              </button>
              {deleteId === pet.id && (
                <span>
                  {t("이 펫을 영구 삭제할까요? 기존 실행 기록은 유지됩니다.")}
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() =>
                      void perform(async () => {
                        await deleteAgentPet(session, pet);
                        publishPetLibrary(session, null);
                        setDeleteId(null);
                        await refreshCollection();
                        setStatus("펫을 삭제했습니다.");
                      }, true)
                    }
                  >
                    {t("영구 삭제")}
                  </button>
                  <button type="button" disabled={locked} onClick={() => setDeleteId(null)}>
                    {t("취소")}
                  </button>
                </span>
              )}
            </div>
          ))}
        </details>
      )}
      <details className="pet-usage-help">
        <summary>{t("펫 사용 안내")}</summary>
        <p className="pet-customizer-intro">
          {t(
            "AI가 요청한 외형과 성향의 픽셀 펫을 만듭니다. 생성에는 기본 제공 AI 사용량이 적용되고, 저장한 동료는 다음 업무부터 함께합니다."
          )}
        </p>
      </details>
      {loadError && <p role="alert">{t(loadError)}</p>}
      <p role="status" aria-live="polite">
        {t(status)}
      </p>
    </section>
  );
}
