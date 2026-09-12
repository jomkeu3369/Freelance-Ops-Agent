import { AgentRunView, AgentRunUsage, WorkflowEvent } from "../../../../app/lib/api";
import { ArrowRight, CheckCircle, Receipt, Warning } from "@phosphor-icons/react";
import { eventDataText, routeActivityLabels } from "../../shared/activity-presentation";
import { providerLabels } from "../../shared/constants";
import { AnalysisDepartments } from "./analysis-departments";
import { AnalysisUsage } from "./analysis-usage";

interface AnalysisResultProps {
  run: AgentRunView;
  events: WorkflowEvent[];
  costUsage: AgentRunUsage | null;
  onCompareQuotes: () => void;
}

export function AnalysisResult({ run, events, costUsage, onCompareQuotes }: AnalysisResultProps) {
  const latestRouteEvent = [...events].reverse().find((event) => event.type === "route.selected") ?? null;
  const selectedRoute = latestRouteEvent ? eventDataText(latestRouteEvent, "route") : null;
  const routingProvider = latestRouteEvent ? eventDataText(latestRouteEvent, "routingProvider") : null;
  const routingModel = latestRouteEvent ? eventDataText(latestRouteEvent, "routingModel") : null;

  if (!run.result) return null;

  return (
    <div className="run-result">
      {run.status === "PARTIAL" && (
        <div className="run-partial">
          <Warning size={20} />
          <div>
            <strong>일부 분석 결과를 먼저 제공합니다.</strong>
            <p>
              완료된 단계의 검증된 결과만 표시합니다. 누락된 단계는 다시 분석해 보완할 수 있습니다.
            </p>
            {run.errorCode && <small>중단 사유 · {run.errorCode}</small>}
          </div>
        </div>
      )}
      <span className={`result-state${run.status === "PARTIAL" ? " partial" : ""}`}>
        {run.status === "PARTIAL" ? <Warning size={17} /> : <CheckCircle size={17} />}{" "}
        {run.status === "PARTIAL" ? "부분 분석 결과" : "분석 결과"}
      </span>
      <h3>프로젝트 요약</h3>
      <p>{run.result.projectSummary}</p>
      {run.metadata && (
        <details className="run-provenance run-technical-details">
          <summary>실행 정보</summary>
          <dl className="run-model-routing">
            <div>
              <dt>경로 판정</dt>
              <dd>
                {routingModel
                  ? `${providerLabels[routingProvider ?? ""] ?? routingProvider ?? "OpenAI"} · ${routingModel}`
                  : "정책 Gate"}
              </dd>
            </div>
            <div>
              <dt>선택 경로</dt>
              <dd>
                {selectedRoute
                  ? (routeActivityLabels[selectedRoute] ?? selectedRoute)
                  : "기록 확인 중"}
              </dd>
            </div>
            <div>
              <dt>분석 실행</dt>
              <dd>
                {providerLabels[run.metadata.provider] ?? run.metadata.provider} ·{" "}
                {run.metadata.model}
              </dd>
            </div>
            <div>
              <dt>자동 전환</dt>
              <dd>사용 안 함</dd>
            </div>
          </dl>
          <small>
            프롬프트 {run.metadata.promptVersion} · 도구 규격 {run.metadata.toolSchemaVersion}
          </small>
        </details>
      )}
      {run.result.openQuestions.length > 0 && (
        <details className="run-open-questions workspace-disclosure">
          <summary>아직 확인할 질문 <small>{run.result.openQuestions.length}개</small></summary>
          <ul>
            {run.result.openQuestions.map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ul>
        </details>
      )}
      {(run.result.quotationDrafts?.length || run.result.quotationDraft) && (
        <section className="ai-quote-ready">
          <div>
            <Receipt size={20} />
            <span>AI 견적 초안</span>
            <strong>
              {run.result.quotationDrafts?.length === 3
                ? "핵심·권장·확장 3개 견적안을 준비했습니다."
                : `${run.result.quotationDraft?.items.length ?? 0}개 작업 항목을 준비했습니다.`}
            </strong>
            <small>
              각 안의 범위와 공수는 AI가 나누고, 단가와 최종 금액은 등록된 기준으로 계산합니다.
            </small>
          </div>
          <button type="button" className="secondary-button" onClick={onCompareQuotes}>
            견적 비교하기 <ArrowRight size={16} />
          </button>
        </section>
      )}
      <AnalysisDepartments results={run.result.departmentResults} />
      <AnalysisUsage usage={run.usage} costUsage={costUsage} />
    </div>
  );
}
