// 서버 코드와 검증되지 않은 응답 상세를 인증 화면에 노출하지 않는다.
// 인증 실패 메시지로 계정 존재 여부나 실패한 항목을 구분할 수 없게 한다.
export function authErrorMessage(error) {
  const code = error?.code ?? error?.message;
  if (code === "INVALID_CREDENTIALS" || error?.status === 401) {
    return "로그인하지 못했습니다. 이메일과 비밀번호를 확인해 주세요.";
  }
  if (error?.status === 0) {
    return "서버에 연결할 수 없습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.";
  }
  if (error?.status === 429) {
    return "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.";
  }
  if (error?.status >= 500) {
    return "지금은 인증 서비스를 이용할 수 없습니다. 잠시 후 다시 시도해 주세요.";
  }
  if (code === "AGE_CONFIRMATION_REQUIRED") {
    return "만 14세 이상임을 확인해 주세요. 만 14세 미만은 가입할 수 없습니다.";
  }
  return "인증 요청을 완료하지 못했습니다. 입력 내용을 확인하고 다시 시도해 주세요.";
}
