import { AgentRunView, AgentRunUsage } from "../../../../app/lib/api";
import { costStatusLabels, requestTierLabels } from "../../shared/constants";
import { formatMoney } from "../../shared/formatters";

interface AnalysisUsageProps {
  usage: AgentRunView["usage"];
  costUsage: AgentRunUsage | null;
}

export function AnalysisUsage({ usage, costUsage }: AnalysisUsageProps) {
  return (
    <>
      {usage && (
        <dl className="usage-list">
          <div>
            <dt>모델 사용</dt>
            <dd>{usage.modelCalls}</dd>
          </div>
          <div>
            <dt>도구 사용</dt>
            <dd>{usage.toolCalls}</dd>
          </div>
          <div>
            <dt>소요 시간</dt>
            <dd>{Math.round(usage.durationMs / 1000)}초</dd>
          </div>
        </dl>
      )}
      {costUsage && (
        <div className="cost-usage">
          <div>
            <span>예상 AI 비용</span>
            <strong>
              {costUsage.actualCost != null && costUsage.costCurrency
                ? formatMoney(costUsage.actualCost, costUsage.costCurrency)
                : "단가 미등록 / 계산 대기"}
            </strong>
          </div>
          <dl>
            <div>
              <dt>입력 토큰</dt>
              <dd>{costUsage.inputTokens.toLocaleString()}</dd>
            </div>
            <div>
              <dt>출력 토큰</dt>
              <dd>{costUsage.outputTokens.toLocaleString()}</dd>
            </div>
            <div>
              <dt>검색 사용량</dt>
              <dd>{costUsage.searchCredits}</dd>
            </div>
            <div>
              <dt>비용 반영</dt>
              <dd>{costUsage.billableOutcome ? "예" : "아니오"}</dd>
            </div>
          </dl>
          <small>
            제공사 실제 청구액과 다를 수 있습니다. ·{" "}
            {costStatusLabels[costUsage.costStatus] ?? "상태 확인 필요"} ·{" "}
            {requestTierLabels[costUsage.requestTier] ?? "실행 등급 확인 필요"}
          </small>
        </div>
      )}
    </>
  );
}
