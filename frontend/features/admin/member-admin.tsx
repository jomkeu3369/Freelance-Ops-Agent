"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ApiError, AuthSession, loadSession, saveSession, subscribeToSessionRecovery } from "../../app/lib/api";
import { AdminAudit, AdminMember, AdminMemberUsage, AdminPage, AdminUsageHistory, LoginEvent, MemberSummary, getLoginEvents, getMemberAudits, getMemberSummary, getMembers, getMemberUsage, getMemberUsageHistory } from "../../app/lib/admin-members-api";
import { MemberUsage } from "./member-usage";
import { AuthGate } from "../workspace/auth/auth-gate";
import "../workspace/auth/auth.css";
import "./member-admin.css";

type Tab = "members" | "logins" | "audit" | "usage";
type Data = { tab: "members"; page: AdminPage<AdminMember> } | { tab: "logins"; page: AdminPage<LoginEvent> } | { tab: "audit"; page: AdminPage<AdminAudit> } | { tab: "usage"; usage: AdminMemberUsage; history: AdminUsageHistory };
function date(value: string | null) { return value ? new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false }) : "기록 없음"; }

export function MemberAdmin() {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [tab, setTab] = useState<Tab>("members");
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(0);
  const [usageCursors, setUsageCursors] = useState<(string | null)[]>([null]);
  const [selected, setSelected] = useState<AdminMember | null>(null);
  const [summary, setSummary] = useState<MemberSummary | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const scope = useRef<string | null>(null);

  useEffect(() => {
    function accept(next: AuthSession | null) {
      if (scope.current !== next?.userId) {
        scope.current = next?.userId ?? null;
        setSummary(null); setData(null); setSelected(null); setPage(0); setUsageCursors([null]); setTab("members"); setQuery(""); setDraft(""); setStatus(""); setForbidden(false);
      }
      setSession(next); setReady(true);
    }
    Promise.resolve().then(() => accept(loadSession()));
    return subscribeToSessionRecovery(accept);
  }, []);

  useEffect(() => {
    if (!session || (tab === "usage" && !selected)) return;
    const controller = new AbortController();
    const signal = controller.signal;
    Promise.resolve().then(() => { if (!signal.aborted) { setLoading(true); setData(null); setError(null); } });
    const rows = tab === "members" ? getMembers(session, query, status, page, signal).then(page => ({ tab: "members", page }) as Data)
      : tab === "logins" ? getLoginEvents(session, selected?.id ?? "", page, signal).then(page => ({ tab: "logins", page }) as Data)
      : tab === "usage" && selected ? Promise.all([
          getMemberUsage(session, selected.id, signal),
          getMemberUsageHistory(session, selected.id, usageCursors[page] ?? null, signal)
        ]).then(([usage, history]) => ({ tab: "usage", usage, history }) as Data)
      : getMemberAudits(session, page, signal).then(page => ({ tab: "audit", page }) as Data);
    Promise.all([getMemberSummary(session, signal), rows]).then(([nextSummary, nextData]) => {
      if (signal.aborted) return;
      setSummary(nextSummary); setData(nextData); setForbidden(false); setLoading(false);
    }).catch(cause => {
      if (signal.aborted) return;
      setData(null); setSummary(null); setLoading(false);
      if (cause instanceof ApiError && cause.status === 403) { setForbidden(true); setSelected(null); }
      else setError("회원 정보를 불러오지 못했습니다. 다시 시도해 주세요.");
    });
    return () => controller.abort();
  }, [session, tab, query, status, page, selected, retry, usageCursors]);

  function chooseTab(next: Tab) { setTab(next); setPage(0); setData(null); setSelected(null); setUsageCursors([null]); }
  function search(event: FormEvent) { event.preventDefault(); setQuery(draft.trim()); setPage(0); setData(null); setRetry(value => value + 1); }
  function showLogins(member: AdminMember) { setSelected(member); setTab("logins"); setPage(0); setData(null); }

  function showUsage(member: AdminMember) { setSelected(member); setTab("usage"); setPage(0); setData(null); setUsageCursors([null]); }

  if (!ready) return <main className="member-admin"><p role="status">관리자 권한 확인 중…</p></main>;
  if (!session) return <AuthGate error={error} setError={setError} onAuthenticated={async next => { saveSession(next); scope.current = next.userId; setSession(next); }} />;
  return <main className="member-admin" id="main-content">
    <header className="member-admin-heading"><div><p className="member-eyebrow">사이트 관리자</p><h1>회원 및 활동</h1><p>가입 현황, 로그인 기록과 회원별 실제 비용을 확인합니다. 모든 시각은 한국 시간입니다.</p></div><Link href="/workspace/settings">작업 공간으로</Link></header>
    {forbidden ? <section className="member-card" role="alert"><h2>접근 권한이 없습니다.</h2><p>별도의 회원 조회 권한이 필요합니다. 작업 공간 관리자 권한으로는 접근할 수 없습니다.</p></section> : <>
      {summary && <section aria-label="회원 현황" className="member-metrics">
        <article><span>전체 회원</span><strong>{summary.totalMembers.toLocaleString()}</strong></article>
        <article><span>로그인 가능한 계정</span><strong>{summary.activeMembers.toLocaleString()}</strong><small>별도 인증 대기 {summary.pendingVerification.toLocaleString()}명</small></article>
        <article><span>최근 7일 가입</span><strong>{summary.joinedLast7Days.toLocaleString()}</strong></article>
        <article><span>최근 7일 로그인 회원</span><strong>{summary.signedInLast7Days.toLocaleString()}</strong><small>기록 시작 이후 · 중복 제외</small></article>
      </section>}
      <nav aria-label="회원 관리 보기" className="member-tabs">{([ ["members", "회원 목록"], ["logins", "로그인 기록"], ["audit", "관리자 변경 기록"] ] as const).map(([key, label]) => <button key={key} type="button" aria-current={tab === key ? "page" : undefined} onClick={() => chooseTab(key)}>{label}</button>)}</nav>
      <section className="member-card" aria-busy={loading}>
        {tab === "members" && <form className="member-filter" onSubmit={search}>
          <label>회원 검색<input value={draft} onChange={event => setDraft(event.target.value)} maxLength={100} placeholder="이메일, 이름 또는 회원 ID" /></label>
          <label>계정 상태<select value={status} onChange={event => { setStatus(event.target.value); setPage(0); setData(null); }}><option value="">모든 상태</option><option value="ACTIVE">활성</option><option value="PENDING_VERIFICATION">이메일 인증 대기</option><option value="DISABLED">비활성</option></select></label>
          <button type="submit">검색</button>
        </form>}
        {tab === "logins" && <div><h2>{selected ? `${selected.displayName ?? selected.email}의 로그인 기록` : "전체 로그인 기록"}</h2>{selected && <button type="button" onClick={() => { setSelected(null); setPage(0); setData(null); }}>모든 회원 보기</button>}<p>성공한 비밀번호 로그인과 가입 세션만 표시합니다. 토큰 갱신은 로그인 횟수에 포함하지 않습니다.</p></div>}
        {summary && (tab === "members" || tab === "logins") && <p className="member-note">로그인 기록 시작: {date(summary.recordingStartedAt)}. 이전 기록이 없는 회원은 최근 로그인을 알 수 없습니다.</p>}
        {tab === "audit" && <div><h2>관리자 변경 기록</h2><p>주간 크레딧·이전 월간 한도 변경과 전체 초기화 기록입니다. 과거 값을 새 API 비용으로 환산하지 않습니다.</p><Link href="/admin">한도 설정 및 초기화 검토</Link></div>}
        {tab === "usage" && selected && <div><h2>{selected.displayName ?? selected.email}의 실제 비용</h2><p>{selected.email}</p><button type="button" onClick={() => chooseTab("members")}>회원 목록으로</button></div>}
        {error && <p role="alert">{error}</p>}
        <button className="member-refresh" type="button" disabled={loading} onClick={() => { setData(null); if (tab === "usage") { setPage(0); setUsageCursors([null]); } setRetry(value => value + 1); }}>새로고침</button>
        {loading && <p role="status">불러오는 중…</p>}
        {!loading && data?.tab === "usage" && tab === "usage" && <>
          <MemberUsage usage={data.usage} history={data.history} />
          <nav className="member-pagination" aria-label="비용 기록 페이지 이동">
            <button type="button" disabled={page === 0} onClick={() => { setPage(value => value - 1); setData(null); }}>이전</button>
            <span>{page + 1} 페이지 · 최신 실행부터</span>
            <button type="button" disabled={!data.history.nextCursor} onClick={() => {
              const cursor = data.history.nextCursor;
              if (!cursor) return;
              setUsageCursors(current => [...current.slice(0, page + 1), cursor]); setPage(value => value + 1); setData(null);
            }}>다음</button>
          </nav>
        </>}
        {!loading && data && data.tab !== "usage" && data.tab === tab && <>
          {data.page.items.length === 0 ? <p className="member-empty">조건에 맞는 기록이 없습니다.</p> : <div className="member-table-scroll" tabIndex={0} role="region" aria-label="관리 목록">
            {data.tab === "members" && <table><caption className="member-sr-only">회원 목록</caption><thead><tr><th>회원</th><th>상태</th><th>가입일</th><th>최근 로그인</th><th>활동</th></tr></thead><tbody>{data.page.items.map(member => <tr key={member.id}><td><strong>{member.displayName || "이름 없음"}</strong><span>{member.email}</span><small>{member.id}</small></td><td><span className="member-badge">{member.status === "ACTIVE" ? "활성" : "비활성"}</span>{member.emailVerificationRequired && <small>이메일 인증 대기</small>}</td><td>{date(member.joinedAt)}</td><td>{date(member.lastLoginAt)}</td><td><button type="button" onClick={() => showLogins(member)} aria-label={`${member.email} 로그인 기록`}>로그인 기록</button><button type="button" onClick={() => showUsage(member)} aria-label={`${member.email} 실제 비용`}>실제 비용</button></td></tr>)}</tbody></table>}
            {data.tab === "logins" && <table><caption className="member-sr-only">로그인 기록</caption><thead><tr><th>시각</th><th>회원 ID</th><th>방식</th></tr></thead><tbody>{data.page.items.map(event => <tr key={event.id}><td>{date(event.occurredAt)}</td><td>{event.userId}</td><td>{event.method === "PASSWORD" ? "비밀번호 로그인" : "가입 세션"}</td></tr>)}</tbody></table>}
            {data.tab === "audit" && <table><caption className="member-sr-only">한도 변경 감사 기록</caption><thead><tr><th>시각 / 관리자 ID</th><th>작업</th><th>대상 / 원장</th><th>이전 → 변경</th><th>초기화 세대</th></tr></thead><tbody>{data.page.items.map(event => <tr key={`${event.source}:${event.id}`}><td>{date(event.createdAt)}<small>{event.actorUserId}</small></td><td>{event.action === "RESET_ALL" ? "전체 초기화" : event.action === "CHANGE_LIMIT" ? "한도 변경" : "모델 가격 변경"}</td><td>{event.target}<small>{event.source}</small></td><td>{event.previousValue} → {event.newValue}</td><td>{event.previousEpoch} → {event.newEpoch}</td></tr>)}</tbody></table>}
          </div>}
          <nav className="member-pagination" aria-label="페이지 이동"><button type="button" disabled={page === 0} onClick={() => { setPage(value => value - 1); setData(null); }}>이전</button><span>{page + 1} / {Math.max(1, Math.ceil(data.page.total / data.page.size))} 페이지 · 총 {data.page.total.toLocaleString()}건</span><button type="button" disabled={(page + 1) * data.page.size >= data.page.total} onClick={() => { setPage(value => value + 1); setData(null); }}>다음</button></nav>
        </>}
      </section>
    </>}
  </main>;
}
