import type { PendingRunRetry } from "../../../app/lib/pending-run-store";
import { CreditDecision } from "../../../app/lib/credit-policy";
import { useT } from "../../../app/lib/ui-language";

export function CreditCostNote({ decision, retry, active = false, policy = false, loading, onRetry }: { active?: boolean; policy?: boolean; decision: CreditDecision; retry?: PendingRunRetry; loading: boolean; onRetry: () => void }) {
  const t = useT();
  const message = active ? t("진행 중인 요청이 끝나면 다음 요청의 차감량을 확인할 수 있습니다.") : policy ? t("견적 기본 설정 변경안 · AI 크레딧 차감 없음 · 확인 후 적용") : retry ? retry.creditQuote ? t("접수 여부가 불확실한 이전 요청을 확인합니다. 원래 확인한 {credits} 크레딧과 요청 내용을 그대로 사용합니다.", { credits: retry.creditQuote.credits }) : t("접수 여부가 불확실한 이전 요청을 같은 내용으로 확인합니다. 개인 API 키 설정은 그대로 유지됩니다.") : decision.kind === "byok" ? t("개인 API 키 사용 · 제공사 계정에 사용 요금이 청구됩니다. 운영 보호한도가 적용됩니다.")
    : loading ? t("보내기 전 크레딧 가격을 확인하고 있습니다.")
      : decision.kind === "ready" ? t("이번 요청 {credits} 크레딧 · {remaining} 크레딧 남음", { credits: decision.quote.credits, remaining: decision.remaining })
        : decision.kind === "insufficient" ? t("{credits} 크레딧 필요 · {remaining} 크레딧 남음", { credits: decision.quote.credits, remaining: decision.remaining })
          : decision.kind === "disabled" ? t("이 모델은 기본 제공 AI에서 사용할 수 없습니다. 다른 모델이나 개인 API 키를 선택해 주세요.")
            : t("크레딧 가격을 확인한 뒤 기본 제공 AI를 보낼 수 있습니다.");
  return <div className={`agent-chat-credit-note ${decision.kind}`} role="status"><span>{message}</span>
    {!active && !policy && decision.kind !== "byok" && !loading && (decision.kind === "unavailable" || decision.kind === "disabled" || decision.kind === "insufficient") && <button type="button" className="quiet-button" onClick={onRetry}>{t("다시 확인")}</button>}
  </div>;
}
