export interface ServiceNotice {
  id: string;
  kind: "OPERATIONAL" | "TERMS_VERSION" | "PRIVACY_VERSION";
  title: string;
  body: string;
  versionLabel: string;
  effectiveAt: string | null;
  publishAt: string | null;
  status: "DRAFT" | "REVIEWED" | "PUBLISHED";
  contentHash: string;
  revision: number;
}

export interface NoticeCampaign {
  id: string;
  noticeId: string;
  status: "DRAFT" | "QUEUED" | "CANCELLED" | "COMPLETED";
  contentHash: string;
  recipientHash: string;
  recipientCount: number;
  snapshotTitle: string;
  snapshotVersionLabel: string;
  snapshotBody?: string;
  testStatus: null | "BLOCKED_TRANSPORT" | "ACCEPTED" | "RETRYABLE_FAILED" | "PERMANENT_FAILED" | "UNKNOWN" | "BOUNCED";
  createdAt: string;
  deliveries: Record<string, number>;
}

export interface NoticeAdministration {
  notices: ServiceNotice[];
  campaigns: NoticeCampaign[];
  transportReady: boolean;
}

export type NoticeInput = Pick<ServiceNotice, "kind" | "title" | "body" | "versionLabel" | "effectiveAt">;
