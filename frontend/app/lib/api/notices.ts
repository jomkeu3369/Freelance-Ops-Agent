import type { AuthSession } from "./contracts/auth";
import type { NoticeAdministration, NoticeCampaign, NoticeInput, ServiceNotice } from "./contracts/notices";
import { request } from "./http";

export function listPublicNotices(): Promise<ServiceNotice[]> {
  return request("/api/v2/notices", { cache: "no-store" });
}

export function getNoticeAdministration(session: AuthSession): Promise<NoticeAdministration> {
  return request("/api/v2/admin/notices", { cache: "no-store" }, session.accessToken);
}

export function createNotice(session: AuthSession, input: NoticeInput): Promise<ServiceNotice> {
  return request("/api/v2/admin/notices", { method: "POST", body: JSON.stringify(input) }, session.accessToken);
}

export function reviewNotice(session: AuthSession, notice: ServiceNotice): Promise<ServiceNotice> {
  return request(
    `/api/v2/admin/notices/${encodeURIComponent(notice.id)}/review`,
    { method: "POST", body: JSON.stringify({ expectedRevision: notice.revision }) },
    session.accessToken
  );
}

export function publishNotice(session: AuthSession, notice: ServiceNotice, publishAt: string): Promise<ServiceNotice> {
  return request(
    `/api/v2/admin/notices/${encodeURIComponent(notice.id)}/publish`,
    {
      method: "POST",
      body: JSON.stringify({ expectedRevision: notice.revision, publishAt, confirmation: "PUBLISH_NOTICE" })
    },
    session.accessToken
  );
}

export function prepareNoticeCampaign(session: AuthSession, noticeId: string): Promise<NoticeCampaign> {
  return request(
    "/api/v2/admin/notice-campaigns",
    { method: "POST", body: JSON.stringify({ noticeId }) },
    session.accessToken
  );
}

export function testNoticeCampaign(session: AuthSession, id: string): Promise<NoticeCampaign> {
  return request(
    `/api/v2/admin/notice-campaigns/${encodeURIComponent(id)}/test`,
    { method: "POST" },
    session.accessToken
  );
}

export function confirmNoticeCampaign(session: AuthSession, campaign: NoticeCampaign): Promise<NoticeCampaign> {
  return request(
    `/api/v2/admin/notice-campaigns/${encodeURIComponent(campaign.id)}/confirm`,
    {
      method: "POST",
      body: JSON.stringify({
        contentHash: campaign.contentHash,
        recipientHash: campaign.recipientHash,
        recipientCount: campaign.recipientCount,
        confirmation: "QUEUE_OPERATIONAL_NOTICE"
      })
    },
    session.accessToken
  );
}

export function cancelNoticeCampaign(session: AuthSession, id: string): Promise<NoticeCampaign> {
  return request(
    `/api/v2/admin/notice-campaigns/${encodeURIComponent(id)}/cancel`,
    { method: "POST", body: JSON.stringify({}) },
    session.accessToken
  );
}
