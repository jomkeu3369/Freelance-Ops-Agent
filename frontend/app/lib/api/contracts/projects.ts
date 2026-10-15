export interface Project {
  id: string;
  workspaceId: string;
  clientId: string | null;
  title: string;
  requirementText: string;
  currency: string;
  deadline: string | null;
  budgetMin: number | null;
  budgetMax: number | null;
  status: string;
  updatedAt: string;
  version?: number;
}

export interface Client {
  id: string;
  workspaceId: string;
  name: string;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  status: "ACTIVE" | "ARCHIVED";
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface ClientInput {
  name: string;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
}

export type ProjectStatus =
  | "LEAD"
  | "QUALIFYING"
  | "QUOTING"
  | "NEGOTIATING"
  | "ACCEPTED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED";

export interface ProjectInput {
  clientId: string | null;
  title: string;
  requirementText: string;
  currency: string;
  deadline: string | null;
  budgetMin: number | null;
  budgetMax: number | null;
}

export interface RequirementFeature {
  title: string;
  description: string;
  priority: "MUST" | "SHOULD" | "COULD" | "WONT";
  acceptanceCriteria: string;
}

export interface RequirementVersion {
  id: string;
  workspaceId: string;
  projectId: string;
  versionNumber: number;
  sourceText: string;
  features: RequirementFeature[];
  assumptions: string[];
  questions: Array<{ content: string; status: string }>;
  createdBy: string;
  createdAt: string;
}
