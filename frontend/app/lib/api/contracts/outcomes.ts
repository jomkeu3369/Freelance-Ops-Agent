import type { QuotationItem, QuotationScenario } from "./quotations";

export interface ActualOutcome {
  id: string;
  workspaceId: string;
  projectId: string;
  approvedQuotationId: string | null;
  totalRevenue: number;
  actualCost: number;
  actualHours: number;
  profitAmount: number;
  profitMargin: number;
  completedOn: string | null;
  changeReason: string | null;
  workItems: Array<{
    quotationItemId: string | null;
    title: string;
    actualHours: number;
    actualCost: number;
    notes: string | null;
  }>;
  version: number;
}

export interface ProposalShare {
  shareId: string;
  token: string;
  publicPath: string;
  expiresAt: string;
  createdAt: string;
}

export interface SharedProposal {
  quotationId: string;
  projectId: string;
  projectTitle: string;
  versionNumber: number;
  scenario: QuotationScenario;
  currency: string;
  subtotal: number;
  discountTotal: number;
  riskBufferAmount: number;
  taxAmount: number;
  total: number;
  validUntil: string | null;
  publishedAt: string;
  shareExpiresAt: string;
  items: Omit<QuotationItem, "rateCardId">[];
}
