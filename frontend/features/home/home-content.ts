import { Calculator, Check, ChatCenteredText, Question, TreeStructure } from "@phosphor-icons/react";
import type { WorkflowEvent } from "@/app/lib/api";

// 소개 화면의 문구와 예시 데이터입니다. 실제 고객 데이터와 연결되지 않습니다.
export const workflowSteps = [
  ["문의 등록", "고객의 메시지와 문서를 하나의 프로젝트에 모읍니다."],
  ["요구사항 정리", "목표, 기능, 일정, 예산, 제약과 빠진 정보를 구분합니다."],
  ["확인 질문", "견적 전에 반드시 확인해야 할 질문을 우선순위로 제안합니다."],
  ["WBS·견적 작성", "작업별 공수와 금액을 계산하고 세 가지 범위를 비교합니다."],
  ["검토·제안", "프리랜서가 초안을 확정한 뒤 고객에게 전달합니다."]
] as const;

export const workflowVisuals = [
  { inputs: ["고객 메시지", "참고 문서"], process: "프로젝트", outputs: ["원문 보존", "자료 연결"], icon: ChatCenteredText },
  { inputs: ["목표·기능", "일정·제약"], process: "구조화", outputs: ["확정 정보", "빠진 정보"], icon: TreeStructure },
  { inputs: ["누락 정보", "조건 충돌"], process: "사용자 확인", outputs: ["답변 반영", "범위 확정"], icon: Question },
  { inputs: ["작업 항목", "단가·가정"], process: "금액 자동 계산", outputs: ["핵심안", "권장안", "확장안"], icon: Calculator },
  { inputs: ["범위·금액", "근거·가정"], process: "최종 검토", outputs: ["승인", "수정 요청", "거절"], icon: Check }
] as const;

export const previewEvents: WorkflowEvent[] = [
  { eventId: 1, runId: "preview", type: "run.started", occurredAt: "", data: {} },
  { eventId: 2, runId: "preview", type: "tool.started", occurredAt: "", data: {} },
  { eventId: 3, runId: "preview", type: "requirement.updated", occurredAt: "", data: {} },
  { eventId: 4, runId: "preview", type: "evidence.added", occurredAt: "", data: {} },
  { eventId: 5, runId: "preview", type: "quotation.draft.created", occurredAt: "", data: {} },
  { eventId: 6, runId: "preview", type: "approval.requested", occurredAt: "", data: {} }
] as const;

export const outcomes = [
  {
    title: "견적 확정",
    metric: "예상 18일",
    body: "사용자가 승인한 작업 범위와 공수만 기준선으로 보존합니다."
  },
  {
    title: "실제 결과 기록",
    metric: "실제 21일",
    body: "범위 변경, 실제 공수와 원가를 프로젝트 종료 후 기록합니다."
  },
  {
    title: "다음 견적 참고",
    metric: "+3일 차이",
    body: "승인된 과거 사례를 검색 근거로 사용하되 자동 학습으로 과장하지 않습니다."
  }
] as const;

export const evidenceExamples = [
  {
    title: "포트폴리오 관리 기능",
    effort: "5–7일",
    rate: "Backend 단가표",
    calculation: "6일 × 일 단가 + 위험 대비 금액",
    assumption: "이미지 최적화는 기본 수준",
    sources: [["유사 완료 프로젝트", "승인된 프로젝트 2건의 실제 공수 범위"], ["사용자 단가표", "Backend 작업 · 현재 적용 중"], ["명시된 가정", "고객 확인 전에는 사실로 확정하지 않습니다."]]
  },
  {
    title: "관리자 콘텐츠 편집",
    effort: "3–4일",
    rate: "Full-stack 단가표",
    calculation: "3.5일 × 일 단가",
    assumption: "역할은 관리자 1종으로 제한",
    sources: [["요구사항 원문", "관리자가 프로젝트를 직접 수정해야 함"], ["사용자 단가표", "Full-stack 작업 · 현재 적용 중"], ["확인 질문", "세부 권한 분리가 필요한지 고객 확인 필요"]]
  },
  {
    title: "반응형 화면 검수",
    effort: "1–2일",
    rate: "Frontend 단가표",
    calculation: "1.5일 × 일 단가",
    assumption: "지원 범위는 390px 이상",
    sources: [["완료 기준", "모바일·태블릿·데스크톱 주요 화면 검수"], ["사용자 단가표", "Frontend 작업 · 현재 적용 중"], ["명시된 가정", "별도 네이티브 앱 검수는 제외"]]
  }
] as const;

