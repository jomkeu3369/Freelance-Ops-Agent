import type { PendingRunRetry } from "../../../app/lib/pending-run-store";
import { useT } from "../../../app/lib/ui-language";

/** Only actionable notices belong in the composer; the actual-cost ledger owns usage. */
export function CreditCostNote({ retry, active = false, policy = false, reviewRequired = false }: {
  active?: boolean; policy?: boolean; reviewRequired?: boolean; retry?: PendingRunRetry;
}) {
  const t = useT();
  if (active || !policy && !retry && !reviewRequired) return null;
  const message = policy ? t("견적 기본 설정 변경안 · 주간 한도 차감 없음 · 확인 후 적용")
    : retry ? t("접수 여부가 불확실한 이전 요청을 원래 확인한 조건으로 다시 확인합니다.")
      : t("서버의 사용량 계약을 다시 확인해야 합니다. 입력은 보존되었습니다. 자동으로 다시 보내지 않습니다.");
  return <div className="agent-chat-credit-note"><div className="chat-credit-notice" role="status"><span>{message}</span></div></div>;
}
