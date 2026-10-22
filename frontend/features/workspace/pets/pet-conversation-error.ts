export function petConversationError(cause: unknown): string | null {
  const message = cause instanceof Error ? cause.message : "";
  const messages: Record<string,string> = {
    CONVERSATION_SETTINGS_CHANGED: "다른 창에서 대화 설정이 변경되었습니다. 다시 확인 후 보내 주세요.",
    CONVERSATION_RUN_ACTIVE: "진행 중인 응답을 먼저 멈춰 주세요.",
    CONVERSATION_PET_UNAVAILABLE: "선택한 펫을 사용할 수 없습니다. 참여 펫을 다시 선택해 주세요.",
    CONVERSATION_INVALID_TEAM: "참여 펫을 1명부터 3명까지 다시 선택해 주세요.",
    CONVERSATION_DRAFT_UNAVAILABLE: "반영할 견적 제안을 확인하지 못했습니다. 대화 결과를 다시 확인해 주세요.",
    CONVERSATION_VERIFICATION_REQUIRED: "요구사항·공수·근거 검증이 완료된 제안만 반영할 수 있습니다. 검증 결과를 확인해 주세요."
  };
  return Object.entries(messages).find(([code]) => message.includes(code))?.[1] ?? null;
}
