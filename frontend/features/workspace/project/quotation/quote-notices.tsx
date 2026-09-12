import {
  Clock,
  Warning
} from "@phosphor-icons/react";

import type { QuoteBuilderModel } from "./use-quote-builder";

export function QuoteNotices({ model }: { model: QuoteBuilderModel }) {
  const { draftStatus, discardDraft, error, conflictLatest, loadQuotation, continueWithCurrentDraft } = model;

  return (
    <>
      {draftStatus && (
        <div
          className={`quote-draft-state ${draftStatus.kind}`}
          role={draftStatus.kind === "unavailable" ? "alert" : "status"}
          aria-live="polite"
        >
          <Clock size={19} />
          <div>
            <strong>
              {draftStatus.kind === "generated"
                ? "AI가 견적 초안을 채웠습니다."
                : draftStatus.kind === "restored"
                  ? "작성 중이던 견적을 불러왔습니다."
                  : draftStatus.kind === "saved"
                    ? "작성 중인 견적을 이 탭에 임시 저장했습니다."
                    : "현재 브라우저에서는 임시 저장을 사용할 수 없습니다."}
            </strong>
            <small>
              {draftStatus.kind === "generated"
                ? "비어 있는 단가를 입력하고 공수와 가정을 확인하세요."
                : draftStatus.kind === "unavailable"
                  ? "초안을 저장하기 전에는 화면을 닫거나 다른 곳으로 이동하지 마세요."
                  : `${draftStatus.updatedAt ? new Date(draftStatus.updatedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : "방금"} 저장 · 다른 브라우저에서는 이어서 볼 수 없습니다.`}
            </small>
          </div>
          {draftStatus.kind !== "unavailable" && (
            <button type="button" className="quiet-button" onClick={discardDraft}>
              임시저장 버리기
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="inline-error" role="alert">
          <Warning size={18} />
          {error}
        </div>
      )}
      {conflictLatest && (
        <section className="quote-conflict" role="alert">
          <div>
            <Warning size={21} />
            <div>
              <strong>다른 사용자가 새 견적안을 먼저 저장했습니다.</strong>
              <p>
                작성 중인 내용은 그대로 남아 있습니다. 최신 v{conflictLatest.versionNumber}을 불러오거나 현재
                내용을 새 견적안으로 저장할 수 있습니다.
              </p>
            </div>
          </div>
          <div>
            <button type="button" className="secondary-button" onClick={() => loadQuotation(conflictLatest)}>
              최신 견적안 불러오기
            </button>
            <button
              type="button"
              className="quiet-button"
              onClick={continueWithCurrentDraft}
            >
              현재 내용으로 계속
            </button>
          </div>
        </section>
      )}
    </>
  );
}
