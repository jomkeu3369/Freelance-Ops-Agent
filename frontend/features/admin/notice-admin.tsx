"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ApiError, AuthSession, NoticeAdministration, NoticeCampaign, NoticeInput, ServiceNotice, cancelNoticeCampaign, confirmNoticeCampaign, createNotice, getNoticeAdministration, loadSession, prepareNoticeCampaign, publishNotice, reviewNotice, saveSession, subscribeToSessionRecovery, testNoticeCampaign } from "../../app/lib/api";
import { LanguageSelector, useT } from "../../app/lib/ui-language";
import { AuthGate } from "../workspace/auth/auth-gate";
import { useDialogFocusTrap } from "../workspace/shared/use-dialog-focus-trap";
import "../workspace/auth/auth.css";
import "../workspace/usage/free-usage.css";
import "../notices/notices.css";

type Confirmation = { kind: "publish"; notice: ServiceNotice; publishAt: string } | { kind: "queue" | "cancel"; campaign: NoticeCampaign };
const kindLabels = { OPERATIONAL: "운영 공지", TERMS_VERSION: "이용약관 버전 정보", PRIVACY_VERSION: "개인정보 처리방침 버전 정보" };
const statusLabels = { DRAFT: "초안", REVIEWED: "검토 완료", PUBLISHED: "게시 승인됨", QUEUED: "대기열", CANCELLED: "취소됨", COMPLETED: "처리 완료" };
function localDateTime(value: string) { const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 19); }
const testLabels = { BLOCKED_TRANSPORT: "발송 비활성 · 전송되지 않음", ACCEPTED: "테스트 전송 접수됨", RETRYABLE_FAILED: "테스트 실패", PERMANENT_FAILED: "테스트 실패", UNKNOWN: "테스트 결과 확인 불가", BOUNCED: "테스트 메일 반송" };

export function NoticeAdmin() {
  const t = useT();
  const [hydrated, setHydrated] = useState(false);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [data, setData] = useState<NoticeAdministration | null>(null);
  const [observedAt, setObservedAt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [kind, setKind] = useState<NoticeInput["kind"]>("OPERATIONAL");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const dialog = useRef<HTMLElement>(null);
  useDialogFocusTrap(dialog, () => setConfirmation(null), busy, confirmation !== null, true);

  useEffect(() => {
    Promise.resolve().then(() => { setSession(loadSession()); setHydrated(true); });
    return subscribeToSessionRecovery(next => { setSession(next); if (!next) { setData(null); setConfirmation(null); } });
  }, []);
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    getNoticeAdministration(session).then(next => {
      if (cancelled) return;
      setData(next); setObservedAt(Date.now()); setForbidden(false); setLoading(false);
    }).catch(cause => {
      if (cancelled) return;
      setData(null); setConfirmation(null); setLoading(false);
      if (cause instanceof ApiError && cause.status === 403) setForbidden(true);
      else setError("공지 관리 정보를 확인하지 못했습니다. 다시 확인해 주세요.");
    });
    return () => { cancelled = true; };
  }, [session, retry]);

  function refresh() { setData(null); setConfirmation(null); setError(null); setLoading(true); setRetry(value => value + 1); }
  function prepare(value: Confirmation) {
    if (pending.current) return;
    setError(null); setMessage(null); setAcknowledged(false); setConfirmation(value);
  }
  async function mutate(action: () => Promise<unknown>, success: string | ((result: unknown) => string)) {
    if (!session || pending.current) return false;
    pending.current = true; setBusy(true); setError(null); setMessage(null);
    try {
      const result = await action();
      const next = await getNoticeAdministration(session);
      setData(next); setObservedAt(Date.now()); setConfirmation(null); setAcknowledged(false);
      setMessage(typeof success === "function" ? success(result) : success);
      return true;
    } catch (cause) {
      // Do not replay uncertain mutations. Reload and require a fresh review.
      setData(null); setConfirmation(null); setAcknowledged(false);
      if (cause instanceof ApiError && cause.status === 403) setForbidden(true);
      else setError(cause instanceof ApiError && cause.status === 409
        ? "정보가 변경되었거나 실행 조건을 충족하지 못했습니다. 다시 확인한 뒤 검토해 주세요."
        : "요청 결과를 확인하지 못했습니다. 다시 확인해 현재 상태를 검토한 뒤 진행하세요.");
      return false;
    } finally { pending.current = false; setBusy(false); }
  }
  async function submitDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || pending.current) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const effective = String(fields.get("effectiveAt") ?? "");
    const input: NoticeInput = { kind, title: String(fields.get("title")).trim(), versionLabel: String(fields.get("versionLabel")).trim(), body: kind === "OPERATIONAL" ? String(fields.get("body") ?? "").trim() : "", effectiveAt: effective ? new Date(effective).toISOString() : null };
    const saved = await mutate(() => createNotice(session, input), "초안을 저장했습니다. 게시와 메일 대기열 승인은 별도로 진행하세요.");
    if (saved) { form.reset(); setKind("OPERATIONAL"); }
  }
  async function applyConfirmation() {
    if (!session || !confirmation || !acknowledged || pending.current) return;
    if (confirmation.kind === "publish") {
      await mutate(() => publishNotice(session, confirmation.notice, confirmation.publishAt), "운영 공지 게시를 승인했습니다. 지정한 게시 시각부터 공개됩니다.");
    } else if (confirmation.kind === "queue") {
      if (confirmation.campaign.testStatus !== "ACCEPTED" || confirmation.campaign.recipientCount < 1) return;
      await mutate(() => confirmNoticeCampaign(session, confirmation.campaign), "메일 대기열에 등록했습니다. 실제 발송 완료를 의미하지 않습니다.");
    } else await mutate(() => cancelNoticeCampaign(session, confirmation.campaign.id), "미발송 메일을 취소했습니다. 이미 처리된 메일은 회수되지 않습니다.");
  }

  if (!hydrated) return <main className="notice-page"><p role="status">{t("관리자 권한 확인 중…")}</p></main>;
  if (!session) return <AuthGate error={error} setError={setError} onAuthenticated={async next => { saveSession(next); setSession(next); setData(null); setLoading(true); setForbidden(false); }} />;
  return <main id="main-content" className="notice-page">
    <header className="notice-header"><nav aria-label={t("관리자 탐색")}><Link href="/admin">{t("사이트 관리자")}</Link><Link href="/notices">{t("공개 공지 보기")}</Link><Link href="/workspace/settings">{t("작업 공간으로 돌아가기")}</Link></nav><LanguageSelector /></header>
    <h1>{t("운영 공지 및 메일 관리")}</h1><p>{t("별도 공지 관리자 권한이 필요합니다. 작업 공간 역할과는 무관합니다.")}</p>
    {forbidden ? <section role="alert" className="notice-card"><h2>{t("접근 권한이 없습니다.")}</h2><p>{t("별도 공지 관리자 권한이 필요합니다. 작업 공간 역할과는 무관합니다.")}</p></section> : <>
      {loading && <p role="status">{t("관리자 권한 확인 중…")}</p>}
      {error && <p role="alert" className="notice-warning">{t(error)}</p>}
      {message && <p role="status">{t(message)}</p>}
      {!loading && <button type="button" className="secondary-button" disabled={busy} onClick={refresh}>{t("다시 확인")}</button>}
      {data && <>
        <p className="notice-warning">{t(data.transportReady ? "메일 전송 기능이 활성화되어 있습니다. 테스트와 대기열 승인은 별도로 진행하세요." : "메일 전송 기능이 비활성화되어 있습니다. 테스트 요청과 대기열은 실제 발송을 의미하지 않습니다.")}</p>
        <section className="notice-card" aria-labelledby="notice-create-title"><h2 id="notice-create-title">{t("새 공지 초안")}</h2><p className="notice-warning">{t("필수 서비스 운영 공지만 등록하세요. 광고·쿠폰·판촉 메일은 지원하지 않습니다. 공지나 발송은 약관 동의를 대신하지 않습니다.")}</p><p>{t("이용약관과 개인정보 처리방침은 내부 버전 정보만 저장합니다. 이 화면에서 법률 문서를 게시하지 않습니다.")}</p>
          <form className="notice-form" onSubmit={submitDraft} aria-busy={busy}><fieldset disabled={busy}>
            <label>{t("공지 종류")}<select name="kind" value={kind} onChange={event => setKind(event.target.value as NoticeInput["kind"])}>{Object.entries(kindLabels).map(([key, label]) => <option key={key} value={key}>{t(label)}</option>)}</select></label>
            <label>{t("제목")}<input name="title" required maxLength={200} /></label>
            <label>{t("버전")}<input name="versionLabel" required maxLength={80} /></label>
            <label>{t("적용 시각 (이 기기의 시간대)")}<input name="effectiveAt" type="datetime-local" required /></label>
            {kind === "OPERATIONAL" ? <label>{t("공지 본문")}<textarea name="body" required maxLength={20000} /></label> : <p className="notice-warning">{t("법률 문서 본문은 입력하거나 저장하지 않습니다. 버전 정보는 비공개로 유지됩니다.")}</p>}
            <button className="primary-button" type="submit">{busy ? t("처리 중…") : t("비공개 초안 저장")}</button>
          </fieldset></form>
        </section>
        <section aria-labelledby="notice-list-title"><h2 id="notice-list-title">{t("공지 및 내부 버전 정보")}</h2>{data.notices.length === 0 && <p>{t("저장된 공지가 없습니다.")}</p>}
          {data.notices.map(notice => <article className="notice-card" key={notice.id} aria-label={notice.title}>
            <h3>{notice.title}</h3><p>{t(kindLabels[notice.kind])} · {t(statusLabels[notice.status])} · {t("버전")}: {notice.versionLabel} · {t("개정")}: {notice.revision}</p>
            {notice.kind === "OPERATIONAL" ? <div className="notice-body">{notice.body}</div> : <p>{t("내부 버전 정보 · 공개되지 않음")}</p>}
            {notice.effectiveAt && <p>{t("적용 시각")}: {new Date(notice.effectiveAt).toLocaleString()}</p>}{notice.publishAt && <p>{t("게시 시각")}: {new Date(notice.publishAt).toLocaleString()}</p>}
            <div className="notice-actions">
              {notice.status === "DRAFT" && <button type="button" disabled={busy} onClick={() => void mutate(() => reviewNotice(session, notice), "초안 검토를 완료했습니다. 아직 게시되거나 발송되지 않았습니다.")}>{t("검토 완료로 표시")}</button>}
              {notice.kind === "OPERATIONAL" && notice.status === "REVIEWED" && <button type="button" disabled={busy} onClick={() => prepare({ kind: "publish", notice, publishAt: new Date().toISOString() })}>{t("공개 게시 검토")}</button>}
              {notice.kind === "OPERATIONAL" && notice.status === "PUBLISHED" && notice.publishAt !== null && Date.parse(notice.publishAt) <= observedAt && <button type="button" disabled={busy} onClick={() => void mutate(() => prepareNoticeCampaign(session, notice.id), "공지 내용과 확인된 이메일 수신자 목록을 고정한 초안을 준비했습니다.")}>{t("메일 수신자 초안 준비")}</button>}
            </div>
          </article>)}
        </section>
        <section aria-labelledby="campaign-list-title"><h2 id="campaign-list-title">{t("메일 대기열 초안")}</h2><p>{t("확인된 이메일만 수신자에 포함됩니다. 테스트는 확인된 관리자 본인 이메일만 대상으로 합니다.")}</p><Link href="/verify-email">{t("내 이메일 확인 링크 요청")}</Link>
          {data.campaigns.length === 0 && <p>{t("준비된 메일 초안이 없습니다.")}</p>}
          {data.campaigns.map(campaign => <article className="notice-card" key={campaign.id} aria-label={`${t("메일 초안")}: ${campaign.snapshotTitle}`}>
            <h3>{campaign.snapshotTitle}</h3><dl><dt>{t("버전")}</dt><dd>{campaign.snapshotVersionLabel}</dd><dt>{t("수신자 수")}</dt><dd>{t("{count}명", { count: campaign.recipientCount })}</dd><dt>{t("수신자 고정 시각")}</dt><dd>{new Date(campaign.createdAt).toLocaleString()}</dd><dt>{t("상태")}</dt><dd>{t(statusLabels[campaign.status])}</dd><dt>{t("본인 테스트")}</dt><dd>{campaign.testStatus ? t(testLabels[campaign.testStatus]) : t("아직 테스트하지 않음")}</dd></dl>
            {Object.keys(campaign.deliveries).length > 0 && <details><summary>{t("처리 상태별 건수")}</summary><ul>{Object.entries(campaign.deliveries).map(([status, count]) => <li key={status}>{status}: {count}</li>)}</ul></details>}
            <div className="notice-actions">{campaign.status === "DRAFT" && <>
              <button type="button" disabled={busy} onClick={() => void mutate(() => testNoticeCampaign(session, campaign.id), result => (result as NoticeCampaign).testStatus === "BLOCKED_TRANSPORT" ? "메일 전송 기능이 비활성화되어 테스트 메일을 보내지 않았습니다." : (result as NoticeCampaign).testStatus === "ACCEPTED" ? "본인 테스트 전송이 접수되었습니다. 수신 내용을 확인한 뒤 대기열을 승인하세요." : "테스트 메일을 접수하지 못했습니다. 상태를 확인해 주세요.")}>{t("내 이메일로 테스트 요청")}</button>
              <button type="button" disabled={busy || campaign.testStatus !== "ACCEPTED" || campaign.recipientCount < 1 || !campaign.snapshotTitle || !campaign.snapshotVersionLabel} onClick={() => prepare({ kind: "queue", campaign })}>{t("대기열 등록 검토")}</button>
            </>}{(campaign.status === "DRAFT" || campaign.status === "QUEUED") && <button type="button" disabled={busy} onClick={() => prepare({ kind: "cancel", campaign })}>{t("미발송 취소 검토")}</button>}</div>
            {campaign.status === "DRAFT" && campaign.recipientCount === 0 && <p>{t("수신자가 없어 대기열에 등록할 수 없습니다.")}</p>}
          </article>)}
        </section>
      </>}
    </>}
    {confirmation && data && !forbidden && <div className="free-usage-backdrop"><section ref={dialog} className="free-usage-dialog notice-confirmation" role="dialog" aria-modal="true" aria-labelledby="notice-confirm-title" aria-describedby="notice-confirm-description" aria-busy={busy}>
      <h2 id="notice-confirm-title">{t(confirmation.kind === "publish" ? "운영 공지를 공개할까요?" : confirmation.kind === "queue" ? "메일을 대기열에 등록할까요?" : "미발송 메일을 취소할까요?")}</h2>
      <p id="notice-confirm-description">{t(confirmation.kind === "publish" ? "지정 시각부터 모든 방문자에게 공개됩니다. 메일 발송은 별도입니다." : confirmation.kind === "queue" ? "고정된 내용과 수신자 수를 확인하세요. 대기열 등록은 실제 발송 완료를 의미하지 않습니다." : "아직 발송되지 않은 항목을 중지합니다. 이미 처리된 메일은 회수되지 않습니다.")}</p>
      {confirmation.kind === "publish" ? <>
        <dl><dt>{t("제목")}</dt><dd>{confirmation.notice.title}</dd><dt>{t("버전")}</dt><dd>{confirmation.notice.versionLabel}</dd><dt>{t("개정")}</dt><dd>{confirmation.notice.revision}</dd></dl><div className="notice-body">{confirmation.notice.body}</div>
        <label className="notice-form">{t("게시 시각 (이 기기의 시간대)")}<input type="datetime-local" step={1} defaultValue={confirmation.publishAt ? localDateTime(confirmation.publishAt) : ""} disabled={busy} onChange={event => { const value = event.target.value; setAcknowledged(false); setConfirmation({ ...confirmation, publishAt: value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toISOString() : "" }); }} /></label>
        <p>{t("게시 시각은 적용 시각보다 늦을 수 없습니다.")}</p>
        <p>{t("게시 시각")}: {confirmation.publishAt ? new Date(confirmation.publishAt).toLocaleString() : t("게시 시각을 선택해 주세요.")}</p>
      </> : <><dl><dt>{t("메일 제목")}</dt><dd>{confirmation.campaign.snapshotTitle}</dd><dt>{t("버전")}</dt><dd>{confirmation.campaign.snapshotVersionLabel}</dd><dt>{t("수신자 수")}</dt><dd>{t("{count}명", { count: confirmation.campaign.recipientCount })}</dd></dl>{confirmation.kind === "queue" && confirmation.campaign.snapshotBody && <div className="notice-body">{confirmation.campaign.snapshotBody}</div>}</>}
      <label className="free-usage-checkbox"><input type="checkbox" checked={acknowledged} disabled={busy} onChange={event => setAcknowledged(event.target.checked)} />{t(confirmation.kind === "queue" ? "본인 테스트 메일과 고정된 내용·수신자 수를 확인했습니다." : "위 내용과 영향을 확인했습니다.")}</label>
      <div className="free-usage-actions"><button type="button" data-autofocus className="secondary-button" disabled={busy} onClick={() => setConfirmation(null)}>{t("돌아가기")}</button><button type="button" className="primary-button" disabled={busy || !acknowledged || (confirmation.kind === "publish" && (!confirmation.publishAt || !confirmation.notice.effectiveAt || Date.parse(confirmation.publishAt) > Date.parse(confirmation.notice.effectiveAt)))} onClick={applyConfirmation}>{busy ? t("처리 중…") : t(confirmation.kind === "publish" ? "공개 게시 승인" : confirmation.kind === "queue" ? "대기열 등록 승인" : "미발송 취소 승인")}</button></div>
    </section></div>}
  </main>;
}
