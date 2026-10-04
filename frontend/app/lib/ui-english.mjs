import { creditEnglish } from "./ui-credit-english.mjs";
import { noticeEnglish } from "./ui-notice-english.mjs";
import { freeUsageEnglish } from './ui-free-usage-english.mjs';
import { workspaceEnglish } from './ui-workspace-english.mjs';
import { projectEnglish } from './ui-project-english.mjs';
import { quoteEnglish } from './ui-quote-english.mjs';
import { analysisEnglish } from './ui-analysis-english.mjs';
import { extraEnglish } from './ui-extra-english.mjs';
import { chatEnglish } from './ui-chat-english.mjs';
import { homeEnglish } from './ui-home-english.mjs';
import { storyEnglish } from './ui-story-english.mjs';
import { petEnglish } from './ui-pet-english.mjs';
// Korean source keys are the fallback. Only interface copy and fictional examples belong here.
export const englishUi = {
  ...creditEnglish,
  "Freelance Ops | 근거 있는 견적 운영": "Freelance Ops | Evidence-based estimates",
  ...noticeEnglish,
  ...freeUsageEnglish,
  ...workspaceEnglish,
  ...projectEnglish,
  ...quoteEnglish,
  ...analysisEnglish,
  ...extraEnglish,
  ...chatEnglish,
  ...homeEnglish,
  ...storyEnglish,
  ...petEnglish,
  "표시 언어": "Interface language", "본문으로 건너뛰기": "Skip to main content",
  "진행 중": "In progress", "협상 중": "Negotiating", "프로젝트 이름": "Project name", "고객 문의": "Client inquiry",
  "문의 등록 예시": "Sample inquiry", "같은 문의의 프로젝트 상태 변화": "Status of the same sample project",
  "가상의 고객 문의:": "Fictional client inquiry:", "문의가 보드에 정리되었습니다.": "The inquiry is now on the board.",
  "문의 내용을 입력하는 예시입니다.": "Entering a sample inquiry.", "등록한 문의가 같은 프로젝트로 이어집니다.": "The inquiry stays with this project.",
  "같은 프로젝트가 협상 중으로 이동했습니다. 범위와 금액을 검토하세요.": "The same project moved to Negotiating. Review the scope and price.",
  "요구사항 · 견적 검토": "Requirements · estimate", "제안서 · 범위 협의": "Proposal · scope",
  "예약 웹사이트": "Booking website", "고객이 시간을 선택하고, 관리자가 예약을 확인하면 좋겠어요. 모바일에서도 쓸 수 있어야 해요.": "Customers should choose a time and admins should review bookings. It needs to work on mobile too.",
  "문의": "Inquiry", "요구사항": "Requirements", "리스크": "Risks", "견적": "Estimate", "제안": "Proposal",
  "문의 원문 보관": "Inquiry saved", "기능별 요구사항 정리": "Requirements organized", "확인 질문과 제외 범위 정리": "Questions and exclusions reviewed", "작업별 공수와 금액 계산": "Effort and price calculated", "검토할 제안서 초안 준비": "Proposal ready for review",
  "핵심 범위": "Core scope", "예약 변경 추가": "Add rescheduling", "원": " KRW", "일": " days",
  "주요 탐색": "Main navigation", "Freelance Ops 홈": "Freelance Ops home", "모바일 메뉴 닫기": "Close menu", "모바일 메뉴 열기": "Open menu",
  "페이지 이동": "Page navigation", "제품 소개": "Product", "작동 방식": "How it works", "운영 원칙": "Principles", "사용 대상": "Who it is for",
  "라이트 테마 전환": "Use light theme", "다크 테마 전환": "Use dark theme", "로그인": "Log in", "요구사항 정리 시작하기": "Start an inquiry",
  "모호한 고객 문의를, 근거 있는 제안으로.": "From vague inquiries to grounded proposals.", "고객 문의에서 요구사항과 불확실성을 분리하고,": "Separate requirements from uncertainty,",
  "확인 질문·WBS·견적·제안서를 함께 준비합니다.": "then prepare questions, tasks, estimates and proposals.", "작동 방식 보기": "See how it works",
  "AI 초안은 사용자가 검토하고 확정합니다.": "You review and approve every AI draft.", "Freelance Ops · 프로젝트 한눈에 보기": "Freelance Ops · Project overview", "제품 예시": "Product example",
  "프로젝트 현황 예시: 신규 문의부터 결과 회고까지 진행 단계를 관리하는 대시보드": "Project dashboard example showing stages from inquiry to retrospective",
  "01 / 고객의 한마디": "01 / A client inquiry", "“예약 가능한 웹사이트,": "“A booking website—", "얼마면 만들 수 있나요?”": "how much would it cost?”",
  "아직 모호한 요청": "An open-ended request", "02 / 검토할 수 있는 초안": "02 / A draft you can review", "요구사항과 근거 연결": "Requirements tied to evidence", "최종 판단은 사용자에게": "You make the final decision",
  "한국 프리랜서의 고객 업무를 위한 첫 단계": "A starting point for freelance client work", "다음 고객 문의부터,": "Your next client inquiry,", "더 명확하게 시작하세요.": "with a clearer start.",
  "요구사항을 정리하고, 확인할 질문을 찾고, 근거 있는 제안의 첫 초안을 만들어 보세요.": "Organize requirements, identify open questions and draft a proposal with evidence.",
  "웹·앱·업무 자동화 프로젝트를 중심으로 설계했습니다.": "Built for web, app and business automation projects.", "초안과 계산 근거를 볼 수 있으며, 결과물은 확인 없이 확정되지 않습니다.": "Review drafts and calculations. Nothing is finalized without your approval.",
  "고객 문의를 구조화된 요구사항과 근거 있는 제안으로 정리하는 프리랜서 운영 도구": "A freelance workspace for turning inquiries into structured requirements and grounded proposals",
  "문의에서 제안까지": "FROM INQUIRY TO PROPOSAL", "한 번의 문의가,": "One inquiry becomes", "검토 가능한 제안서가 됩니다.": "a proposal you can review.",
  "원문에서 빠진 정보를 찾고, 작업의 근거를 연결합니다.": "Find missing details and connect tasks to their evidence.", "같은 문의가 제안서가 되는 과정을 직접 살펴보세요.": "Follow the same inquiry all the way to a proposal.",
  "완료": "Done", "정리 중": "Organizing", "대기": "Waiting", "원문 보관": "Keep the original", "제안서 초안": "Proposal draft", "고객의 한마디": "A client inquiry", "예약 가능한 웹사이트,": "A booking website—", "얼마면 만들 수 있나요?": "how much would it cost?", "원문을 보관했습니다.": "Original inquiry retained.",
  "제품 체험 · 가상의 문의와 결과": "Interactive demo · Fictional inquiry and results", "동작 줄이기 적용": "Reduced motion", "자동 진행 예시": "Autoplay demo", "동작 줄이기 적용 중": "Reduced motion enabled", "예시 자동 진행 재개": "Resume demo", "자동 진행 일시 정지": "Pause demo", "제품 예시 단계 선택": "Choose a demo stage", "이 문의의 흐름": "This inquiry", "자동 예시 완료": "Autoplay stage complete", "예시 결과 보기": "Preview stage", "확정은 사용자의 몫": "You approve the result", "검토 전 예시": "Sample draft",
  "견적은 이 한마디에서 시작합니다.": "An estimate starts with an inquiry.", "메시지는 그대로 보관하고, 확인할 정보를 따로 정리합니다.": "Keep the original message and separate the details to clarify.", "이 메시지에서 찾은 것": "What the message tells us", "예약 · 시간 선택": "Booking · time slots", "관리자 화면": "Admin interface", "모바일 대응": "Mobile support", "결제 방식과 예약 변경 정책은 아직 확인이 필요합니다.": "Payment and rescheduling policies still need clarification.", "정리된 요구사항 보기": "View requirements",
  "말로 들어온 문의를, 작업 단위로.": "Turn the inquiry into tasks.", "기능과 완료 조건을 함께 적어 범위의 해석을 맞춥니다.": "Define features and acceptance criteria to align the scope.", "고객이 가능한 시간을 고르고 예약을 등록합니다.": "Customers select an available time and book.", "관리자 예약 관리": "Admin booking management", "관리자 1명이 예약 목록과 상세 내용을 확인합니다.": "One administrator reviews the booking list and details.", "반응형 화면": "Responsive interface", "휴대폰에서도 예약을 등록하고 확인할 수 있습니다.": "Customers can book and review bookings on a phone.", "포함": "Included", "고객 예약 변경": "Customer rescheduling", "고객이 정해진 정책 안에서 예약 시간을 변경합니다.": "Customers reschedule within the agreed policy.", "추가": "Added", "원문과 연결": "Linked to the inquiry", "“모바일에서도 쓸 수 있어야 해요.” → 반응형 화면": "“It needs to work on mobile too.” → Responsive interface",
  "모르는 것은, 견적에 숨기지 않습니다.": "Keep uncertainty visible.", "빠진 정보를 질문으로 바꾸고, 포함하지 않을 범위도 명시합니다.": "Turn missing details into questions and state the exclusions.", "확인 질문 01": "Question 01", "온라인 결제도 필요한가요?": "Do you need online payments?", "예시 답변 · 결제는 현장에서 해요. 온라인 결제는 필요 없어요.": "Sample answer · Customers pay on site. No online payments needed.", "예시 답변 반영": "Sample answer applied", "예약 변경 정책은 확인이 필요합니다.": "The rescheduling policy needs clarification.", "취소 가능 시간과 변경 횟수에 따라 작업 범위가 달라집니다.": "Cancellation windows and rescheduling limits affect the scope.", "예약 변경 범위 선택": "Choose rescheduling scope", "범위를 바꿔 비교해 보세요": "Compare different scopes", "제외 범위 · 온라인 결제, 별도 모바일 앱": "Excluded · Online payments, a separate mobile app",
  "숫자마다, 설명할 수 있는 근거를.": "A reason behind every number.", "작업별 공수 × 예시 일단가. 범위를 바꾸며 차이를 확인하세요.": "Task effort × sample daily rate. Change the scope to compare.", "견적 범위 선택": "Choose estimate scope", "작업별 예시 공수와 금액": "Sample task effort and price", "작업": "Task", "공수": "Effort", "금액": "Price", "예시 일단가": "Sample daily rate", "부가세 별도 · 실제 견적 아님": "Excludes VAT · Illustrative estimate", "계산 가정": "Calculation assumptions", "관리자 1명, 현장 결제, 고객의 디자인 자료 제공. 견적 전에 가정을 확인합니다.": "One admin, on-site payments, client-provided design assets. Confirm assumptions before quoting.", "예약 화면 · 시간 선택": "Booking · time selection", "반응형 · 검수": "Responsive design · QA",
  "이제 고객과 같은 범위를 봅니다.": "Share the same scope with your client.", "합의할 범위, 금액, 일정이 한 문서에 모입니다.": "Scope, price and schedule in one document.", "제안서 예시 · 검토 전 초안": "Sample proposal · Draft for review", "예약 웹사이트 개발 제안": "Booking website proposal", "포함 범위": "Included scope", "예약 · 관리자 화면 · 반응형": "Booking · Admin · Responsive design", " · 고객 예약 변경": " · Rescheduling", "제외 범위": "Excluded scope", "온라인 결제 · 별도 모바일 앱": "Online payments · Separate mobile app", "예상 공수": "Estimated effort", "일 · 일정은 자료 수령 후 협의": " days · Schedule agreed after receiving assets", "예시 금액": "Sample price", "원 · 부가세 별도": " KRW · Excludes VAT", "예약 변경 정책과 자료 제공 일정을 확인한 뒤 확정합니다.": "Confirm the rescheduling policy and asset delivery before approval.", "사용자 검토 필요": "Needs your review", "금액의 근거 다시 보기": "Review the calculation", "모든 화면은 같은 문의의 예시입니다.": "Every view follows the same fictional inquiry.", "다음 단계": "Next stage",
  "자동 예시 진행 기록": "Demo progress", "예시 완료": "Demo complete", "예시 일시 정지": "Demo paused", "예시 진행 중": "Demo playing", "초안을 준비했습니다. 확정 전에 검토하세요.": "Draft ready. Review it before approval.", "자동 예시 완료 단계": "Completed demo stages", "예시 진행 기록": "Demo history", "자동 재생하면 완료한 단계가 여기에 쌓입니다.": "Completed stages appear here during autoplay.", "단계 선택은 결과 미리보기입니다. 실제 분석이나 저장은 실행되지 않습니다. 마우스나 키보드 포커스가 화면 안에 있으면 자동 재생을 멈춥니다.": "Stage buttons preview results. No real analysis or saving occurs. Hover or keyboard focus pauses autoplay.", "고객에게 전달할 초안": "Client proposal draft", "준비 완료": "Ready", "예시": "Sample", "포함 범위 · 예약 / 관리자 / 반응형": "Scope · Booking / Admin / Responsive", " / 예약 변경": " / Rescheduling", "일 · 부가세 별도": " days · Excludes VAT", "확정 전 사용자 검토가 필요합니다.": "Review required before approval.", "원문은 보관하고, 가정은 드러내고, 확정은 직접.": "Keep the original. Show assumptions. Approve it yourself.", "예시 금액과 공수는 제품 설명용입니다. 실제 작업 공간에서는 내 단가와 근거를 검토한 뒤 확정합니다.": "Prices and effort are illustrative. In your workspace, review your rates and evidence before approval.", "견적 근거 보기": "View estimate evidence"
};
