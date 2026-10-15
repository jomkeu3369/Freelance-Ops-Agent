// 실제 서버·브라우저 상태만으로 표시하며 임의의 진행 타이머는 사용하지 않는다.
export function chatState(status, { online = true, reconnecting = false } = {}) {
  if (!online) return { tone: "offline", label: "오프라인", working: false };
  if (status === "WAITING_FOR_USER") return { tone: "attention", label: "확인 필요", working: false };
  if (status === "COMPLETED") return { tone: "success", label: "완료", working: false };
  if (status === "PARTIAL") return { tone: "attention", label: "부분 결과 제공", working: false };
  if (status === "FAILED") return { tone: "error", label: "작업 실패", working: false };
  if (status === "CANCELLED") return { tone: "muted", label: "중단", working: false };
  if (reconnecting) return { tone: "offline", label: "연결 확인 중", working: false };
  if (status === "RUNNING") return { tone: "working", label: "처리 중", working: true };
  if (status === "QUEUED") return { tone: "muted", label: "실행 대기", working: false };
  return { tone: "muted", label: "요청 준비됨", working: false };
}

export function resultPendingMessage(status) {
  if (status === "COMPLETED" || status === "PARTIAL") return "이 실행에 저장된 결과가 없습니다.";
  if (status === "WAITING_FOR_USER") return "사용자 확인을 기다리고 있습니다";
  if (status === "QUEUED") return "요청이 접수되었습니다. 실행 순서를 기다리고 있습니다.";
  if (status === "RUNNING") return "실제 작업이 진행 중입니다. 확인할 내용이나 결과가 준비되면 여기에 표시됩니다.";
  return "현재 작업 상태를 확인할 수 없습니다. 기록을 다시 불러와 주세요.";
}

// 원문 조회 가능 여부는 실행·결과 조회와 별개다. 저장된 사용자 원문을
// 현재 프로젝트 요구사항이나 경고 문구로 대체하지 않는다.
/** @param {{ requirementText: string | null, originalInputStatus?: string, originalInputIssue?: string | null }} item */
export function originalInputPresentation({ requirementText, originalInputStatus, originalInputIssue }) {
  const text = originalInputStatus !== "UNAVAILABLE" && typeof requirementText === "string" ? requirementText : null;
  const notices = [];
  if (text === null) notices.push("이 요청의 원문을 불러올 수 없습니다.");
  if (originalInputIssue === "INVALID_ATTACHMENTS") notices.push("일부 첨부 자료 정보를 불러올 수 없습니다.");
  else if (originalInputStatus && originalInputStatus !== "AVAILABLE" && text !== null)
    notices.push("이 요청의 원본 입력 일부를 불러올 수 없습니다.");
  return { text, notices };
}
