import type { AuthSession, AgentQuotationDraft, PetProfile } from "../api";
import { request } from "./http";

export interface PetConversationCommand { settingsVersion: number; recipientPetId: string | null }
export interface PetMessage {
  messageId: string; speakerPetId: string | null; speaker: PetProfile | null;
  replyToMessageId: string | null; text: string; evidenceRefs: string[];
  evidence: Array<{ id: string; title: string; content: string }>;
}
export interface PetConversationSettings {
  petMode: boolean; debateEnabled: boolean; participantPetIds: string[];
  acceptedDraft: AgentQuotationDraft | null; draftSourceRunId: string | null;
}
export interface PetConversationView { settings: PetConversationSettings; version: number }
const path = (session: AuthSession, project: string) => `/api/v2/workspaces/${session.workspaceId}/projects/${project}/pet-conversation`;
export function getPetConversation(session: AuthSession, project: string): Promise<PetConversationView> {
  return request(path(session, project), { cache: "no-store" }, session.accessToken);
}
export function updatePetConversation(session: AuthSession, project: string, view: PetConversationView, patch: Partial<Pick<PetConversationSettings,"petMode"|"debateEnabled"|"participantPetIds">>): Promise<PetConversationView> {
  return request(path(session, project), { method:"PUT",body:JSON.stringify({ petMode:view.settings.petMode,
    debateEnabled:view.settings.debateEnabled,participantPetIds:view.settings.participantPetIds,
    ...patch, expectedVersion:view.version }) }, session.accessToken, false);
}
export function acceptPetConversationDraft(session: AuthSession, project: string, runId: string, expectedVersion: number): Promise<PetConversationView> {
  return request(path(session, project)+"/draft",{method:"POST",body:JSON.stringify({runId,expectedVersion})},session.accessToken,false);
}
