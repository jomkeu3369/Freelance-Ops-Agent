export interface RateCard {
  id: string;
  workspaceId: string;
  name: string;
  unit: WorkUnit;
  rate: number;
  minimumAmount: number;
  currency: string;
  active: boolean;
  version: number;
  folderId?: string | null;
}

export interface RateCardFolder {
  id: string;
  workspaceId: string;
  parentId: string | null;
  name: string;
  version: number;
}

export interface EstimationPolicy {
  workspaceId: string;
  defaultTaxRate: number;
  defaultRiskBufferRate: number;
  maximumDiscountRate: number;
  version: number;
}

export interface EstimationPolicyProposal {
  proposalId: string;
  projectId: string;
  sourceMessage: string;
  status: "PENDING" | "APPLIED" | "EXPIRED";
  before: EstimationPolicy;
  after: EstimationPolicy;
  confirmationToken: string;
  expiresAt: string;
  appliedAt: string | null;
  createdAt: string;
}

export type QuotationScenario = "LEAN" | "RECOMMENDED" | "EXPANDED";

export type WorkUnit = "HOUR" | "DAY" | "FIXED";

export type BasisType = "ASSUMPTION" | "EVIDENCE";

export interface QuotationItemInput {
  rateCardId: string | null;
  title: string;
  description: string;
  quantity: number;
  unit: WorkUnit;
  unitRate: number;
  discountRate: number;
  basis: {
    type: BasisType;
    content: string;
    sourceType: "PAST_PROJECT" | "POLICY" | "PLATFORM_TERMS" | "USER_TEMPLATE" | "EXTERNAL_SOURCE" | null;
    sourceReference: string | null;
    sourceTitle: string | null;
    retrievedAt: string | null;
  };
}

export interface QuotationItem extends Omit<QuotationItemInput, "basis"> {
  subtotal: number;
  discountAmount: number;
  total: number;
  basis: QuotationItemInput["basis"];
}

export interface Quotation {
  id: string;
  workspaceId: string;
  projectId: string;
  seriesId: string;
  previousVersionId: string | null;
  versionNumber: number;
  scenario: QuotationScenario;
  status: "DRAFT" | "PUBLISHED" | "SUPERSEDED";
  currency: string;
  subtotal: number;
  discountTotal: number;
  riskBufferRate: number;
  riskBufferAmount: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  validUntil: string | null;
  items: QuotationItem[];
  publishedAt: string | null;
  createdAt: string;
  version: number;
}

export interface QuotationPage {
  items: Quotation[];
  nextCursor: string | null;
}

export interface QuotationPreview {
  subtotal: number;
  discountTotal: number;
  riskBufferRate: number;
  riskBufferAmount: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  items: Array<{ subtotal: number; discountAmount: number; total: number }>;
}
