import { supportedLocales, translateUi } from "../../../../app/lib/ui-locale.mjs";
import type { PendingRunRetry } from "../../../../app/lib/pending-run-store";
import { skillSelectionSignature, type SkillSelection } from "../../skills/skill-selection";

/** 재시도는 표시 문구뿐 아니라 승인된 초안 전체를 그대로 재사용한다. */
export function matchesChatRetry(retry: PendingRunRetry, message: string, attachmentIds: string[], skillSelection?: SkillSelection): boolean {
  return (
    retry.message === message &&
    JSON.stringify(retry.attachmentIds ?? []) === JSON.stringify(attachmentIds) &&
    skillSelectionSignature(retry.skillSelection) === skillSelectionSignature(skillSelection)
  );
}

export const attachmentOnlyPrompt = "첨부 자료의 읽기 범위와 내용을 확인해 주세요.";
const attachmentOnlyMessages = new Set(supportedLocales.map((locale) => translateUi(attachmentOnlyPrompt, locale)));

/** 언어가 바뀌어도 결과가 불확실한 요청의 생성 문구를 다시 작성하지 않는다. */
export function attachmentOnlyRetryMessage(candidates: PendingRunRetry[], attachmentIds: string[], skillSelection?: SkillSelection): string | undefined {
  if (!attachmentIds.length) return undefined;
  return candidates.find(
    (retry) =>
      attachmentOnlyMessages.has(retry.message) && matchesChatRetry(retry, retry.message, attachmentIds, skillSelection)
  )?.message;
}
