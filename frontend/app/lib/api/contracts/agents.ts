import type { SkillSelection } from "../../../../features/workspace/skills/skill-selection";
import type { PetProfile } from "./pets";
import type { BasisType, QuotationScenario, WorkUnit } from "./quotations";

export type Provider = "OPENAI";

export type RecordedProvider = Provider | "GEMINI";

export type ReasoningEffort = "NONE" | "LOW" | "MEDIUM" | "HIGH";

export type AgentRunStatus =
  | "QUEUED"
  | "RUNNING"
  | "WAITING_FOR_USER"
  | "COMPLETED"
  | "PARTIAL"
  | "FAILED"
  | "CANCELLED";

export interface AgentInterruption {
  interruptionId: string;
  kind: "CLARIFICATION" | "RISK_DECISION" | "QUOTE_APPROVAL";
  questions: string[];
}

export interface AgentQuotationDraft {
  petPerspective?: { proposal: string; rationale: string; tradeoff: string } | null;
  scenario: QuotationScenario;
  items: Array<{
    title: string;
    description: string;
    quantity: number;
    unit: WorkUnit;
    rateCardHint: string | null;
    basis: {
      type: BasisType;
      content: string;
      sourceReference: string | null;
      sourceTitle: string | null;
    };
  }>;
}

export interface AgentRunView {
  runId: string;
  status: AgentRunStatus;
  activeDepartment: string | null;
  interruption: AgentInterruption | null;
  result: {
    petMessages?: import("../pet-conversation").PetMessage[];
    projectSummary: string;
    openQuestions: string[];
    departmentResults: Array<{
      department: string;
      status: string;
      summary: string;
      evidenceIds: string[];
      assumptionIds: string[];
      sources: Array<{
        title: string;
        url: string;
        provider: string;
        jurisdiction: string | null;
        excerpt: string;
          contentSha256?: string;
          fetchedAt?: string;
          authorityLevel?: string;
      }>;
      errorCode: string | null;
    }>;
    quotationDraft: AgentQuotationDraft | null;
    quotationDrafts: AgentQuotationDraft[];
  } | null;
  errorCode: string | null;
  metadata: {
    petProfiles?: PetProfile[];
    skillSelection?: SkillSelection | null;
    resolvedSkillIds?: string[];
    deferredSkillIds?: string[];
    credentialId?: string | null;
    provider: RecordedProvider;
    model: string;
    promptVersion: string;
    toolSchemaVersion: string;
    traceId: string;
  } | null;
  usage: {
    requestTier: string;
    modelCalls: number;
    toolCalls: number;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    searchCredits: number;
    crawledPages: number;
    retryCount: number;
    durationMs: number;
  } | null;
  updatedAt: string;
}

export interface AgentRunUsage {
  runId: string;
  requestTier: string;
  modelCalls: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  searchCredits: number;
  crawledPages: number;
  retryCount: number;
  durationMs: number;
  pricingSnapshotId: string | null;
  actualCost: number | null;
  costCurrency: string | null;
  costStatus: string;
  billableOutcome: boolean;
  recordedAt: string;
}

export interface RunAccepted {
  runId: string;
  status: AgentRunStatus;
  acceptedAt: string;
}

export interface OcrOptions {
  ocrLanguage: "mixed" | "ko" | "en";
  ocrLayout: "general" | "singleblock";
}

export interface AttachmentCoverage {
  index: number;
  kind: "PAGE" | "FRAME";
  nativeStatus: "TEXT" | "EMPTY" | "FAILED" | "NOT_APPLICABLE";
  rasterStatus: "NONE" | "SMALL" | "LARGE" | "UNKNOWN" | "NOT_APPLICABLE";
  ocrAttempted: boolean;
  ocrCompleted: boolean;
  ocrStatus: "READ" | "EMPTY" | "FAILED" | "SKIPPED";
  reason:
    | "TEXT_ONLY"
    | "SMALL_RASTER"
    | "SAMPLED_OUT"
    | "BUDGET_EXHAUSTED"
    | "TOOL_UNAVAILABLE"
    | "LANGUAGE_UNAVAILABLE"
    | "TOOL_FAILED"
    | "EMPTY_RESULT"
    | "TEXT_FOUND"
    | "DUPLICATE_ONLY";
}

export interface AttachmentText {
  name: string;
  mediaType: string;
  size: number;
  sha256: string;
  status: "COMPLETE" | "PARTIAL" | "UNSUPPORTED";
  text: string;
  notice: string;
  encoding: string | null;
  delimiter: string | null;
  units: number;
  ocrLanguage?: OcrOptions["ocrLanguage"];
  ocrLayout?: OcrOptions["ocrLayout"];
  coverage?: AttachmentCoverage[];
}

export interface AttachmentPreview {
  id: string;
  expiresAt: string;
  extraction: AttachmentText;
}

export interface AgentRunHistoryAttachment {
  name: string;
  status: string;
  notice: string | null;
}

export interface AgentRunHistoryItem {
  attachments?: AgentRunHistoryAttachment[];
  runId: string;
  requirementText: string | null;
  originalInputStatus?: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";
  originalInputIssue?:
    | "MISSING_START"
    | "MALFORMED_PAYLOAD"
    | "MISSING_INPUT"
    | "INVALID_REQUIREMENT_TEXT"
    | "INVALID_ATTACHMENTS"
    | null;
  status: AgentRunStatus;
  createdAt: string;
}

export interface WorkflowEvent {
  eventId: number;
  runId: string;
  type: string;
  occurredAt: string;
  data: Record<string, unknown>;
}

export interface AIConnection {
  id: string;
  provider: RecordedProvider;
  model: string;
  maskedKey: string;
  updatedAt: string;
}

export interface AIConnections {
  available: boolean;
  models: Record<Provider, string[]>;
  connections: AIConnection[];
}
