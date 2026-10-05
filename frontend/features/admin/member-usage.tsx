import type { AdminMemberUsage, AdminUsageHistory } from "../../app/lib/admin-members-api";

import { formatAdminUsd } from "./member-usage-format";

function date(value: string) {
  return new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false });
}

export function MemberUsage({ usage, history }: { usage: AdminMemberUsage; history: AdminUsageHistory }) {
  return <div className="member-usage">
    <section aria-label="회원 USD 사용량" className="member-metrics member-usage-metrics">
      <article><span>주간 한도</span><strong>{formatAdminUsd(usage.limitUsd)}</strong></article>
      <article><span>확정 플랫폼 비용</span><strong>{formatAdminUsd(usage.settledUsd)}</strong></article>
      <article><span>예약 중인 금액</span><strong>{formatAdminUsd(usage.reservedUsd)}</strong><small>진행 중 또는 사용량 확인 대기</small></article>
      <article><span>사용 가능한 잔액</span><strong>{formatAdminUsd(usage.remainingUsd)}</strong><small>확정 비용과 예약 금액 차감 후</small></article>
    </section>
    <p className="member-note">주간 시작: {usage.periodStart} · 다음 초기화: {date(usage.resetAt)} ({usage.timezone})</p>
    {!usage.spendingEnabled && <p className="member-note">플랫폼 유료 호출이 비활성화되어 있습니다. 표시된 잔액은 호출 가능 여부를 보장하지 않습니다.</p>}
    <p className="member-note">예약 금액은 공급자의 확정 청구액이 아닙니다. 사용량이 확인되지 않은 실행은 보수적으로 예약을 유지합니다. 이전 크레딧을 USD로 환산하지 않습니다.</p>
    <h3>실행별 실제 비용 기록</h3>
    <p className="member-note">전체 기간의 기록입니다. BYOK 호출은 플랫폼 비용에서 제외되며, 같은 실행의 플랫폼 호출은 포함됩니다. BYOK 토큰은 미확정 실행에서 상한 추정치를 포함할 수 있습니다.</p>
    {history.items.length === 0 ? <p className="member-empty">기록된 USD 사용량이 없습니다.</p> : <div className="member-table-scroll" tabIndex={0} role="region" aria-label="회원 비용 기록">
      <table><caption className="member-sr-only">실행별 플랫폼 비용</caption><thead><tr><th>시작 / 실행 ID</th><th>모델 / 상태</th><th>확정 비용</th><th>예약 금액</th><th>사용량 확인</th><th>BYOK 토큰 (입력 / 출력)</th></tr></thead><tbody>
        {history.items.map(entry => <tr key={entry.runId}>
          <td>{date(entry.startedAt)}<small>{entry.runId}</small></td>
          <td>{entry.model}<small>{entry.status === "DELETED" ? "삭제된 실행 · 비용 기록 유지" : entry.status}</small></td>
          <td>{formatAdminUsd(entry.platformCostUsd)}</td><td>{formatAdminUsd(entry.platformReservedUsd)}</td>
          <td>{entry.usageKnown ? "확인 완료" : "확인 대기 · 예약 유지"}</td>
          <td>{entry.byokInputTokens.toLocaleString()} / {entry.byokOutputTokens.toLocaleString()}{!entry.usageKnown && <small>미확정 토큰 포함 가능</small>}</td>
        </tr>)}
      </tbody></table>
    </div>}
  </div>;
}
