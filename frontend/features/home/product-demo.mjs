// Fictional data only: no server run, AI request, or persistence.
export const demoSteps = ["문의", "요구사항", "리스크", "견적", "제안"];
export const demoEvents = ["문의 원문 보관", "기능별 요구사항 정리", "확인 질문과 제외 범위 정리", "작업별 공수와 금액 계산", "검토할 제안서 초안 준비"];
export const demoProject = Object.freeze({ id: "FO-024", title: "예약 웹사이트", request: "예약 가능한 웹사이트, 얼마면 만들 수 있나요? 고객이 시간을 선택하고, 관리자가 예약을 확인하면 좋겠어요. 모바일에서도 쓸 수 있어야 해요." });
export function demoProjectSnapshot(state, reducedMotion = false) {
  const preview = state.manual || reducedMotion;
  const ready = preview || state.selected > 0 || state.phase === "complete";
  const negotiation = state.selected === 4 && (preview || state.phase === "complete");
  return { ...demoProject, ready, column: negotiation ? 1 : 0, status: negotiation ? "협상 중" : "진행 중", detail: demoEvents[state.selected], quote: demoQuote(state.scope) };
}
export const demoScopes = {
  essential: { label: "핵심 범위", days: 10, extra: false },
  extended: { label: "예약 변경 추가", days: 13, extra: true }
};
export function demoQuote(scope = "essential") {
  const option = demoScopes[scope] ?? demoScopes.essential;
  const dailyRate = 300000;
  return { ...option, dailyRate, total: option.days * dailyRate, rows: [
    { title: "예약 화면 · 시간 선택", days: 5 },
    { title: "관리자 예약 관리", days: 3.5 },
    { title: "반응형 · 검수", days: 1.5 },
    ...(option.extra ? [{ title: "고객 예약 변경", days: 3 }] : [])
  ] };
}
export function initialDemoState() {
  return { step: 0, selected: 0, phase: "running", paused: false, manual: false, scope: "essential", history: [], run: 1 };
}
export function demoReducer(state, action) {
  switch (action.type) {
    case "tick":
      if (state.paused || (state.step === 4 && state.phase === "complete")) return state;
      if (state.phase === "running") return { ...state, phase: "complete", history: [...state.history, state.step] };
      return { ...state, step: state.step + 1, selected: state.step + 1, phase: "running" };
    case "select":
      if (!Number.isInteger(action.step) || action.step < 0 || action.step >= demoSteps.length) return state;
      return { ...state, selected: action.step, paused: true, manual: true };
    case "next": return { ...state, selected: (state.selected + 1) % demoSteps.length, paused: true, manual: true };
    case "pause": return state.paused ? { ...state, paused: false, manual: false, selected: state.step } : { ...state, paused: true };
    case "scope": return Object.hasOwn(demoScopes, action.scope) ? { ...state, scope: action.scope, paused: true, manual: true } : state;
    case "replay": return { ...initialDemoState(), scope: state.scope, run: state.run + 1 };
    default: return state;
  }
}
