import type { AuthSession } from "./contracts/auth";
import type { AgentPetCollection, ComposeAgentPet, CustomAgentPet, PetProfile } from "./contracts/pets";
import { request } from "./http";

export function listAgentPets(session: AuthSession): Promise<AgentPetCollection> {
  return request(`/api/v2/workspaces/${session.workspaceId}/agent-pets`, { cache: "no-store" }, session.accessToken);
}

export function previewAgentPet(session: AuthSession, input: ComposeAgentPet): Promise<PetProfile> {
  return request(
    `/api/v2/workspaces/${session.workspaceId}/agent-pets/preview`,
    { method: "POST", body: JSON.stringify(input) },
    session.accessToken,
    false
  );
}

export function saveAgentPet(session: AuthSession, input: ComposeAgentPet): Promise<CustomAgentPet> {
  return request(
    `/api/v2/workspaces/${session.workspaceId}/agent-pets`,
    { method: "POST", body: JSON.stringify(input) },
    session.accessToken,
    false
  );
}

export function changeAgentPet(session: AuthSession, pet: CustomAgentPet, action: "SELECT" | "ARCHIVE" | "RESTORE"): Promise<void> {
  return request(
    `/api/v2/workspaces/${session.workspaceId}/agent-pets/${pet.id}`,
    { method: "PATCH", body: JSON.stringify({ action, expectedRevision: pet.revision }) },
    session.accessToken,
    false
  );
}

export function deleteAgentPet(session: AuthSession, pet: CustomAgentPet): Promise<void> {
  return request(
    `/api/v2/workspaces/${session.workspaceId}/agent-pets/${pet.id}?revision=${pet.revision}`,
    { method: "DELETE" },
    session.accessToken,
    false
  );
}
