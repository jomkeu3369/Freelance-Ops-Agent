import { Provider, ProjectStatus, QuotationScenario } from "../../../app/lib/api";

export const terminalStatuses = new Set(["COMPLETED", "PARTIAL", "FAILED", "CANCELLED", "WAITING_FOR_USER"]);

export const projectDeletionBlockingStatuses = new Set(["QUEUED", "RUNNING", "WAITING_FOR_USER"]);

export const currencyOptions = [
  { value: "KRW", label: "대한민국 원 (KRW)" },
  { value: "USD", label: "미국 달러 (USD)" },
  { value: "JPY", label: "일본 엔 (JPY)" }
] as const;

export function parseModelOptions(value: string | undefined) {
  return [
    ...new Set(
      (value ?? "")
        .split(",")
        .map((model) => model.trim())
        .filter(Boolean)
    )
  ];
}

export const defaultOpenAIModel = process.env.NEXT_PUBLIC_DEFAULT_MODEL?.trim();

export const configuredModelOptions: Record<Provider, string[]> = {
  OPENAI:
    parseModelOptions(process.env.NEXT_PUBLIC_OPENAI_MODELS).length > 0
      ? parseModelOptions(process.env.NEXT_PUBLIC_OPENAI_MODELS)
      : [defaultOpenAIModel || "gpt-5.6-luna", "gpt-5.6-terra"].filter(
          (model, index, models) => models.indexOf(model) === index
        ),
  GEMINI: parseModelOptions(process.env.NEXT_PUBLIC_GEMINI_MODELS)
};

export const suggestedModelOptions = [
  ...new Set([...configuredModelOptions.OPENAI, ...configuredModelOptions.GEMINI])
];

export const pipelineColumns: Array<{
  key: string;
  title: string;
  caption: string;
  statuses: ProjectStatus[];
  moveTo: ProjectStatus;
}> = [
  {
    key: "inquiry",
    title: "신규 문의",
    caption: "아직 분류하지 않은 요청",
    statuses: ["LEAD"],
    moveTo: "LEAD"
  },
  {
    key: "qualifying",
    title: "정보 확인 중",
    caption: "범위와 조건 확인",
    statuses: ["QUALIFYING"],
    moveTo: "QUALIFYING"
  },
  {
    key: "quoting",
    title: "견적 작성 중",
    caption: "WBS와 금액 검토",
    statuses: ["QUOTING"],
    moveTo: "QUOTING"
  },
  {
    key: "negotiating",
    title: "협상 중",
    caption: "발행·수정·승인",
    statuses: ["NEGOTIATING", "ACCEPTED"],
    moveTo: "NEGOTIATING"
  },
  {
    key: "progress",
    title: "진행 중",
    caption: "계약된 프로젝트",
    statuses: ["IN_PROGRESS"],
    moveTo: "IN_PROGRESS"
  },
  {
    key: "review",
    title: "결과 회고",
    caption: "실제 공수 기록 필요",
    statuses: ["COMPLETED"],
    moveTo: "COMPLETED"
  }
];

export const pipelineStatusLabels: Record<string, string> = {
  LEAD: "신규 문의",
  QUALIFYING: "정보 확인 중",
  QUOTING: "견적 작성 중",
  NEGOTIATING: "협상 중",
  ACCEPTED: "고객 승인됨",
  IN_PROGRESS: "진행 중",
  COMPLETED: "결과 회고",
  CANCELLED: "취소됨"
};

export const runStatusLabels: Record<string, string> = {
  QUEUED: "준비 중",
  RUNNING: "분석 중",
  WAITING_FOR_USER: "확인 필요",
  COMPLETED: "분석 완료",
  PARTIAL: "부분 분석 완료",
  FAILED: "실행 중단",
  CANCELLED: "사용자 중단"
};

export const departmentLabels: Record<string, string> = {
  requirements: "요구사항 정리",
  research: "근거 조사",
  risk: "위험 검토",
  deal_design: "범위와 견적 구성"
};

export const providerLabels: Record<string, string> = {
  OPENAI: "OpenAI",
  GEMINI: "Gemini"
};

export const costStatusLabels: Record<string, string> = {
  PRICED: "비용 계산 완료",
  UNPRICED: "요금 기준 확인 필요",
  PENDING: "비용 계산 중"
};

export const requestTierLabels: Record<string, string> = {
  STANDARD: "일반 실행",
  PREMIUM: "확장 실행"
};

export const accountStatusLabels: Record<string, string> = {
  ACTIVE: "사용 중",
  PENDING: "확인 대기",
  SUSPENDED: "사용 중지"
};

export const quotationScenarioLabels: Record<QuotationScenario, string> = {
  LEAN: "핵심안",
  RECOMMENDED: "권장안",
  EXPANDED: "확장안"
};

export const quotationStatusLabels: Record<string, string> = {
  DRAFT: "작성 중",
  PUBLISHED: "발행 완료",
  SUPERSEDED: "이전 버전"
};
