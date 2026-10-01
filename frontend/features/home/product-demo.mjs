// Fictional data only: no server run, AI request, or persistence.
export const demoSteps = ["문의", "요구사항", "리스크", "견적", "제안"];
export const demoEvents = ["문의 원문 보관", "기능별 요구사항 정리", "확인 질문과 제외 범위 정리", "작업별 공수와 금액 계산", "검토할 제안서 초안 준비"];
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
  return { step: 0, selected: 0, phase: "running", paused: false, scope: "essential", history: [], run: 1 };
}
export function demoReducer(state, action) {
  switch (action.type) {
    case "tick":
      if (state.paused || (state.step === 4 && state.phase === "complete")) return state;
      if (state.phase === "running") return { ...state, phase: "complete", history: [...state.history, state.step] };
      return { ...state, step: state.step + 1, selected: state.step + 1, phase: "running" };
    case "select":
      if (!Number.isInteger(action.step) || action.step < 0 || action.step >= demoSteps.length) return state;
      return { ...state, selected: action.step, paused: true };
    case "next": return { ...state, selected: (state.selected + 1) % demoSteps.length, paused: true };
    case "pause": return { ...state, paused: !state.paused };
    case "scope": return Object.hasOwn(demoScopes, action.scope) ? { ...state, scope: action.scope, paused: true } : state;
    case "replay": return { ...initialDemoState(), scope: state.scope, run: state.run + 1 };
    default: return state;
  }
}
