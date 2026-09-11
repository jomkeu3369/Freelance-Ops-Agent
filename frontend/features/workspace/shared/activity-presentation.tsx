import { WorkflowEvent, AgentRunView } from "../../../app/lib/api";
import { providerLabels, departmentLabels } from "./constants";

export const runFailureMessages: Record<string, string> = {
  REACT_TOOL_CALL_INVALID:
    "AI 응답 형식을 자동으로 다시 확인했지만 분석을 계속할 수 없었습니다. 새 분석으로 다시 시도해 주세요.",
  SPRING_TOOL_UNAUTHORIZED: "내부 분석 권한을 확인하지 못했습니다. 실행을 새로 시작해 주세요.",
  SPRING_TOOL_FORBIDDEN:
    "현재 계정에 분석에 필요한 프로젝트 조회 권한이 없습니다. 작업 공간 권한을 확인해 주세요."
};

export function runFailureMessage(errorCode: string | null): string {
  if (!errorCode) return "분석을 완료하지 못했습니다. 새 분석으로 다시 시도해 주세요.";
  return (
    runFailureMessages[errorCode] ?? "분석을 완료하지 못했습니다. 저장된 프로젝트 정보는 변경되지 않았습니다."
  );
}

export const eventActivityLabels: Record<string, string> = {
  "run.accepted": "분석 요청 접수",
  "run.started": "분석 시작",
  "requirement.updated": "요구사항 정리",
  "clarification.requested": "사용자 확인 요청",
  "clarification.responded": "사용자 답변 반영",
  "tool.started": "자료 확인 시작",
  "tool.completed": "자료 확인 완료",
  "evidence.added": "근거 자료 연결",
  "quotation.draft.created": "견적 초안 준비",
  "approval.requested": "최종 확인 요청",
  "run.completed": "분석 완료",
  "run.partial": "부분 분석 완료",
  "run.failed": "분석 중단",
  "run.cancelled": "사용자 중단",
  "route.selected": "실행 경로 선택"
};

export const routeActivityLabels: Record<string, string> = {
  DIRECT_TOOL: "결정적 Tool 실행",
  SIMPLE_LLM: "빠른 요구 정리",
  REACT_AGENT: "ReAct Tool 분석",
  SUPERVISOR: "다중 부서 Supervisor",
  HUMAN_REQUIRED: "사용자 판단 우선"
};

export const routeReasonLabels: Record<string, string> = {
  DETERMINISTIC_OPERATION: "정해진 작업으로 처리할 수 있는 요청",
  SINGLE_RESPONSE: "한 번의 모델 응답으로 정리 가능한 요청",
  PROJECT_ANALYSIS_FULL_WORKFLOW: "첫 분석에 필요한 전체 검토 경로를 적용",
  TOOL_WORKFLOW: "자료 조회와 Tool 실행이 필요한 요청",
  MULTI_DOMAIN: "여러 전문 영역을 함께 검토해야 하는 요청",
  APPROVAL_OR_SENSITIVE: "권한 또는 사용자 승인이 필요한 요청",
  INSUFFICIENT_CONTEXT: "판단에 필요한 정보가 부족한 요청",
  PROMPT_MANIPULATION: "안전 검토가 필요한 입력",
  SAFETY_GATE: "안전 정책에 따라 사용자 확인이 필요한 요청",
  POLICY_GATE: "권한과 안전 정책을 먼저 적용",
  LOCAL_RRF: "로컬 진단 경로가 일치",
  LLM_EVALUATOR: "운영 route evaluator가 선택",
  FAIL_CLOSED: "판단 실패 시 안전한 경로를 선택"
};

export const routeDecisionSourceLabels: Record<string, string> = {
  LLM_EVALUATOR: "AI 경로 평가",
  POLICY_GATE: "정책 우선 판단",
  LOCAL_RRF: "로컬 경로 판단",
  FAIL_CLOSED: "안전 경로 전환"
};

export const toolActivityLabels: Record<string, string> = {
  get_project_context: "프로젝트 맥락 조회",
  web_research: "외부 근거 조사"
};

export function eventDataText(event: WorkflowEvent, key: string): string | null {
  const value = event.data[key];
  return typeof value === "string" && value.trim() ? value : null;
}

export function eventDataTexts(event: WorkflowEvent, key: string): string[] {
  const value = event.data[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    : [];
}

export function activityPresentation(event: WorkflowEvent, run: AgentRunView | null) {
  if (event.type === "route.selected") {
    const route = eventDataText(event, "route");
    const provider = eventDataText(event, "provider");
    const model = eventDataText(event, "model");
    const routingProvider = eventDataText(event, "routingProvider");
    const routingModel = eventDataText(event, "routingModel");
    const decisionSource = eventDataText(event, "decisionSource");
    const evaluatorSuggestedRoute = eventDataText(event, "evaluatorSuggestedRoute");
    const reasons = eventDataTexts(event, "reasonCodes").map((reason) => routeReasonLabels[reason] ?? reason);
    return {
      title: `경로 선택 · ${routeActivityLabels[route ?? ""] ?? route ?? "확인 중"}`,
      detail: reasons.join(" · ") || "요청의 범위와 필요한 작업을 기준으로 실행 경로를 선택했습니다.",
      tags: [
        route ? `경로 ${route}` : null,
        routingModel
          ? `경로 판정 ${providerLabels[routingProvider ?? ""] ?? routingProvider ?? "OpenAI"} · ${routingModel}`
          : "경로 판정 정책 Gate",
        model ? `분석 실행 ${providerLabels[provider ?? ""] ?? provider} · ${model}` : null,
        evaluatorSuggestedRoute
          ? `평가 후보 ${routeActivityLabels[evaluatorSuggestedRoute] ?? evaluatorSuggestedRoute}`
          : null,
        routeDecisionSourceLabels[decisionSource ?? ""] ?? decisionSource
      ].filter((value): value is string => Boolean(value)),
      tone: "route"
    };
  }
  if (event.type === "tool.completed") {
    const toolName = eventDataText(event, "toolName");
    const department = eventDataText(event, "department");
    return {
      title: `Tool 사용 · ${toolActivityLabels[toolName ?? ""] ?? toolName ?? "업무 도구"}`,
      detail: eventDataText(event, "reason") ?? "선택된 경로에 필요한 정보를 확인했습니다.",
      tags: [toolName, department ? (departmentLabels[department] ?? department) : null].filter(
        (value): value is string => Boolean(value)
      ),
      tone: "tool"
    };
  }
  if (event.type === "run.started" && run?.metadata) {
    return {
      title: eventActivityLabels[event.type],
      detail: `${providerLabels[run.metadata.provider] ?? run.metadata.provider}의 ${run.metadata.model} 모델로 분석을 시작했습니다.`,
      tags: [run.metadata.promptVersion],
      tone: "model"
    };
  }
  return {
    title: eventActivityLabels[event.type] ?? "분석 진행",
    detail: null,
    tags: [],
    tone: "default"
  };
}
