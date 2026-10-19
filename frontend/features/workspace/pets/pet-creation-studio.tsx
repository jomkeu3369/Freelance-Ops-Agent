import type { Ref } from "react";
import { ArrowClockwise, ArrowLeft, ArrowRight, Check, CircleNotch, Sparkle } from "@phosphor-icons/react";
import type { PetProfile } from "@/app/lib/api";
import { useT } from "@/app/lib/ui-language";
import { PetArt } from "./pet-art";

interface PetCreationStudioProps {
  prefix: string;
  editingName?: string;
  description: string;
  maxLength: number;
  generating: boolean;
  saving: boolean;
  locked: boolean;
  available: boolean;
  atLimit: boolean;
  profile: PetProfile | null;
  status: string;
  fullHistory: boolean;
  resetPreferences: boolean;
  pendingResult: boolean;
  promptRef: Ref<HTMLTextAreaElement>;
  stageRef: Ref<HTMLElement>;
  onDescriptionChange: (value: string) => void;
  onResetChange: (value: boolean) => void;
  onGenerate: () => void;
  onSave: () => void;
  onEdit: () => void;
  onBack: () => void;
}

export function PetCreationStudio({
  prefix,
  editingName,
  description,
  maxLength,
  generating,
  saving,
  locked,
  available,
  atLimit,
  profile,
  status,
  fullHistory,
  resetPreferences,
  pendingResult,
  promptRef,
  stageRef,
  onDescriptionChange,
  onResetChange,
  onGenerate,
  onSave,
  onEdit,
  onBack
}: PetCreationStudioProps) {
  const t = useT();
  const result = profile;
  const examples = [
    "실현 가능성을 꼼꼼히 판단하는 펭귄",
    "다정한 말투로 일정을 챙기는 고양이",
    "새로운 아이디어를 좋아하는 여우"
  ];
  return (
    <section className="pet-creation" aria-label={t(editingName ? "펫 수정" : "펫 만들기")}>
      <button type="button" className="pet-creation-back" onClick={onBack} disabled={saving}>
        <ArrowLeft size={16} aria-hidden="true" />
        {t("내 펫")}
      </button>
      <header className="pet-creation-heading">
        <span className="pet-creation-eyebrow">
          <Sparkle size={14} aria-hidden="true" />
          {t("AI 픽셀 펫")}
        </span>
        <h3>
          {t(
            generating
              ? "작은 동료를 만들고 있어요"
              : result
                ? "새로운 동료를 만나 보세요"
                : editingName
                  ? "어떤 모습으로 바꿀까요?"
                  : "어떤 동료를 만들까요?"
          )}
        </h3>
        <p>
          {t(
            generating
              ? "요청한 외형과 성향을 AI가 함께 만들고 있어요."
              : result
                ? "마음에 들면 저장해 함께할 수 있어요."
                : "원하는 동물과 성격을 자유롭게 들려주세요."
          )}
        </p>
      </header>
      <section
        className={`pet-creation-stage${generating ? " is-generating" : ""}`}
        ref={stageRef}
        tabIndex={-1}
        aria-label={t(generating ? "펫 생성 중" : result ? "생성된 펫 확인" : "펫 설명 입력")}
      >
        {generating ? (
          <div className="pet-creation-loading" role="status" aria-live="polite">
            <div className="pet-creation-pixels" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
            </div>
            <strong>{t("나만의 픽셀 펫을 그리는 중이에요")}</strong>
            <p>{t("완성되면 이곳에 나타나요. 잠시만 기다려 주세요.")}</p>
            <span className="pet-creation-request">{description}</span>
          </div>
        ) : result ? (
          <div className="pet-creation-result" aria-label={t("생성된 펫 확인")}>
            <div className="pet-creation-portrait">
              <PetArt kind={result.animal} profile={result} />
            </div>
            <span className="pet-creation-species">{result.sprite?.species ?? t("나의 동료")}</span>
            <h4>{result.name}</h4>
            <p>{result.preferences?.personality || result.preferences?.focus}</p>
            {result.preferences?.focus && result.preferences.focus !== result.preferences.personality && (
              <p className="pet-creation-focus">{result.preferences.focus}</p>
            )}
            <details className="pet-creation-request-details">
              <summary>{t("요청한 설명")}</summary>
              <p>{description}</p>
            </details>
          </div>
        ) : (
          <div className="pet-creation-input">
            <label htmlFor={`${prefix}-prompt`}>{t(editingName ? "바꾸고 싶은 점" : "원하는 펫 설명")}</label>
            <textarea
              id={`${prefix}-prompt`}
              ref={promptRef}
              value={description}
              maxLength={maxLength}
              disabled={locked}
              onChange={(event) => onDescriptionChange(event.target.value)}
              placeholder={t(
                "예: 실현 가능성을 꼼꼼히 판단하는 펭귄. 남색 몸과 하얀 배, 작은 안경이 잘 어울렸으면 좋겠어요."
              )}
              aria-describedby={`${prefix}-creation-help`}
            />
            <div className="pet-creation-input-meta">
              <span>{t("동물 · 색감 · 성격을 함께 적어도 좋아요")}</span>
              <span>
                {description.length}/{maxLength}
              </span>
            </div>
            {!editingName && (
              <div className="pet-creation-examples" aria-label={t("설명 예시")}>
                {examples.map((example) => (
                  <button key={example} type="button" disabled={locked} onClick={() => onDescriptionChange(t(example))}>
                    {t(example)}
                  </button>
                ))}
              </div>
            )}
            {editingName && (
              <label className="pet-creation-reset">
                <input
                  type="checkbox"
                  checked={resetPreferences}
                  disabled={locked}
                  onChange={(event) => onResetChange(event.target.checked)}
                />
                {t("이전 요청 대신 이 설명으로 새로 정리")}
              </label>
            )}
            <p id={`${prefix}-creation-help`} className="pet-creation-help">
              {t(
                pendingResult
                  ? "이전 요청의 결과를 확인해요. AI를 다시 호출하지 않아요."
                  : "기본 제공 AI 사용량에 포함돼요. 생성 후 마음에 드는 결과만 저장하세요."
              )}
            </p>
          </div>
        )}
      </section>
      <div className="pet-creation-feedback" aria-live="polite">
        {status && <p role="alert">{t(status)}</p>}
        {!available && !result && !generating && (
          <p>{t("지금은 기본 제공 AI를 사용할 수 없어요. 사용량과 연결 상태를 확인해 주세요.")}</p>
        )}
        {atLimit && !editingName && <p>{t("펫 개수 한도에 도달했어요. 목록에서 사용하지 않는 펫을 보관해 주세요.")}</p>}
        {fullHistory && !resetPreferences && (
          <p>{t("요청 기록이 가득 찼어요. 이전 요청을 포함한 설명으로 새로 정리해 주세요.")}</p>
        )}
      </div>
      <footer className="pet-creation-footer">
        <button
          type="button"
          className="pet-creation-secondary"
          onClick={result || (pendingResult && status && !generating) ? onEdit : onBack}
          disabled={saving}
        >
          {t(
            result ? "설명 수정" : generating ? "목록 보기" : pendingResult && status ? "새로 만들기" : "나중에 만들기"
          )}
        </button>
        <button
          type="button"
          className="pet-creation-primary"
          onClick={result ? onSave : onGenerate}
          disabled={
            locked ||
            (!result &&
              !pendingResult &&
              (!available || !description.trim() || (atLimit && !editingName) || (fullHistory && !resetPreferences)))
          }
          aria-busy={generating || saving}
        >
          {generating || saving ? (
            <CircleNotch size={18} className="pet-creation-spinner" aria-hidden="true" />
          ) : result ? (
            <Check size={18} aria-hidden="true" />
          ) : pendingResult ? (
            <ArrowClockwise size={18} aria-hidden="true" />
          ) : (
            <Sparkle size={18} aria-hidden="true" />
          )}
          {t(
            saving
              ? "저장 중…"
              : generating
                ? "생성 중…"
                : result
                  ? "이 펫과 함께하기"
                  : pendingResult
                    ? "생성 결과 확인"
                    : "펫 생성하기"
          )}
          {!generating && !saving && !result && <ArrowRight size={17} aria-hidden="true" />}
        </button>
      </footer>
    </section>
  );
}
