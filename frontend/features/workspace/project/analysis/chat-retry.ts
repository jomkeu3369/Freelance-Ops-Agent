import type { PendingRunRetry } from "../../../../app/lib/pending-run-store";
import { skillSelectionSignature, type SkillSelection } from "../../skills/skill-selection";

/** A retry reuses the exact authorized draft, not merely its visible message. */
export function matchesChatRetry(retry: PendingRunRetry, message: string, attachmentIds: string[], skillSelection?: SkillSelection): boolean {
  return retry.message === message
    && JSON.stringify(retry.attachmentIds ?? []) === JSON.stringify(attachmentIds)
    && skillSelectionSignature(retry.skillSelection) === skillSelectionSignature(skillSelection);
}
