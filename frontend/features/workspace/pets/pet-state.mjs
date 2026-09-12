export const petAdvisors = [
  { id: "turtle", name: "차근", role: "일정 담당", scenario: "LEAN", priority: "필수 범위와 현실적인 납기", departments: ["REQUIREMENTS"] },
  { id: "owl", name: "또렷", role: "근거 담당", scenario: "RECOMMENDED", priority: "확인된 자료와 균형 잡힌 범위", departments: ["RESEARCH", "VERIFICATION"] },
  { id: "cat", name: "든든", role: "수익 담당", scenario: "EXPANDED", priority: "제공 가치와 명확한 계약 범위", departments: ["DEAL_DESIGN"] }
];

/** @param {import('@/app/lib/api').AgentRunView | null} run @param {string[]} departments */
export function petWorkState(run, departments) {
  if (!run) return "idle";
  if (run.status === "FAILED") return "failed";
  if (run.status === "CANCELLED") return "cancelled";
  if (run.status === "WAITING_FOR_USER") return "waiting";
  if (run.status === "QUEUED") return "queued";
  const results = run.result?.departmentResults.filter(result => departments.includes(result.department)) ?? [];
  if (results.some(result => result.status === "FAILED" || result.errorCode)) return "partial";
  if (departments.every(department => results.some(result => result.department === department && result.status === "COMPLETED"))) return "ready";
  if (run.status === "PARTIAL") return "partial";
  if (run.status === "COMPLETED") return results.length ? "partial" : "notRun";
  return departments.includes(run.activeDepartment ?? "") ? "working" : "queued";
}

export const petStateLabels = {
  idle: "문의 기다리는 중", queued: "차례 기다리는 중", working: "자료 살펴보는 중",
  waiting: "사용자 확인 필요", ready: "검토 결과 준비됨", partial: "확인할 결과가 남았어요",
  failed: "실행을 완료하지 못했어요", cancelled: "사용자가 중단했어요", notRun: "이번 실행에서 수행하지 않음"
};

/** Reject accidental double charging when combining alternatives for the same task. */
export function duplicateTaskTitles(items) {
  const seen = new Set();
  const duplicates = new Set();
  for (const item of items) {
    const key = item.title.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("ko-KR");
    if (seen.has(key)) duplicates.add(item.title);
    seen.add(key);
  }
  return [...duplicates];
}
