export interface MemorySourceMessage {
  id: string;
  eventOrder: number;
  kind: string;
  content: string;
  prompt: string | null;
  createdAt: string;
}

export interface KnowledgeDocument {
  id: string;
  workspaceId: string;
  sourceType: "PAST_PROJECT" | "POLICY" | "PLATFORM_TERMS" | "USER_TEMPLATE" | "EXTERNAL_SOURCE";
  title: string;
  sourceUri: string | null;
  sourceVersion: string | null;
  jurisdiction: string | null;
  effectiveFrom: string | null;
  effectiveUntil: string | null;
  contentSha256: string;
  origin: "user" | "agent" | "external";
  memoryType: string;
  confirmationStatus: "confirmed" | "unconfirmed" | "superseded";
  retrievalEligible: boolean;
  projectId: string | null;
  sourceRunId: string | null;
  sourceMessageIds: string[];
  parentDocumentIds: string[];
  supersedes: string | null;
  revisionNumber: number;
  confirmedBy: string | null;
  confirmedAt: string | null;
  sourceMessages: MemorySourceMessage[];
  status: string;
  chunks: Array<{
    id: string;
    chunkIndex: number;
    content: string;
    embeddingModel: string | null;
    startOffset: number | null;
    endOffset: number | null;
  }>;
  createdAt: string;
  version: number;
}
