import { supportedLocales, translateUi } from "../../../../app/lib/ui-locale.mjs";
import type { PendingRunRetry } from "../../../../app/lib/pending-run-store";
import { skillSelectionSignature, type SkillSelection } from "../../skills/skill-selection";

/** A retry reuses the exact authorized draft, not merely its visible message. */
export function matchesChatRetry(retry: PendingRunRetry, message: string, attachmentIds: string[], skillSelection?: SkillSelection): boolean {
  return retry.message === message
    && JSON.stringify(retry.attachmentIds ?? []) === JSON.stringify(attachmentIds)
    && skillSelectionSignature(retry.skillSelection) === skillSelectionSignature(skillSelection);
}


export const attachmentOnlyPrompt = "첨부 자료의 읽기 범위와 내용을 확인해 주세요.";
const attachmentOnlyMessages = new Set(supportedLocales.map(locale => translateUi(attachmentOnlyPrompt, locale)));

/** Locale changes must not rewrite an uncertain request's generated message. */
export function attachmentOnlyRetryMessage(candidates: PendingRunRetry[], attachmentIds: string[], skillSelection?: SkillSelection): string | undefined {
  if (!attachmentIds.length) return undefined;
  return candidates.find(retry => attachmentOnlyMessages.has(retry.message)
    && matchesChatRetry(retry, retry.message, attachmentIds, skillSelection))?.message;
}
