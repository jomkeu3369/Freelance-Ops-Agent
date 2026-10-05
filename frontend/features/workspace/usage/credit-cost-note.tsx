import type { PendingRunRetry } from "../../../app/lib/pending-run-store";
import { CreditDecision } from "../../../app/lib/credit-policy";
import { useT } from "../../../app/lib/ui-language";

/** Keep send guards conspicuous; the independent cost ledger owns the usage ring. */
export function CreditCostNote({ decision, retry, active = false, policy = false, reviewRequired = false, loading, onRetry }: {
  active?: boolean; policy?: boolean; reviewRequired?: boolean; decision: CreditDecision;
  retry?: PendingRunRetry; loading: boolean; onRetry: () => void;
}) {
  const t = useT();
  const attention = !active && !policy && decision.kind !== "byok" && !loading && ["unavailable", "disabled", "insufficient"].includes(decision.kind);
  if (!active && !policy && !retry && !reviewRequired && !attention) return null;
  const message = active ? t("진행 중인 요청이 끝나면 다음 요청의 차감량을 확인할 수 있습니다.")
    : policy ? t("견적 기본 설정 변경안 · 주간 한도 차감 없음 · 확인 후 적용")
      : retry ? t("접수 여부가 불확실한 이전 요청을 원래 확인한 조건으로 다시 확인합니다.")
        : loading ? t("보내기 전 크레딧 가격을 확인하고 있습니다.")
          : decision.kind === "insufficient" ? t("선택한 모델을 실행할 잔여 한도가 부족합니다.")
            : decision.kind === "disabled" ? t("이 모델은 기본 제공 AI에서 사용할 수 없습니다. 다른 모델이나 개인 API 키를 선택해 주세요.")
              : decision.kind === "unavailable" ? t("요청 가격을 확인한 뒤 기본 제공 AI를 보낼 수 있습니다.")
                : t("요청 가격이 변경되었습니다. 모델 설정에서 새 가격을 확인하고 다시 보내 주세요.");
  return <div className={`agent-chat-credit-note ${decision.kind}`}><div className="chat-credit-notice" role="status"><span>{message}</span>
    {attention && <button type="button" className="quiet-button" onClick={onRetry}>{t("다시 확인")}</button>}
  </div></div>;
}
