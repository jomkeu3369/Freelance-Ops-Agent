"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { listPublicNotices, ServiceNotice } from "../../app/lib/api";
import { LanguageSelector, useT } from "../../app/lib/ui-language";
import "./notices.css";

export function PublicNotices() {
  const t = useT();
  const [notices, setNotices] = useState<ServiceNotice[] | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    listPublicNotices().then(items => {
      if (cancelled) return;
      // Defense in depth: drafts, legal metadata, and future announcements are private.
      setNotices(items.filter(item => item.kind === "OPERATIONAL" && item.status === "PUBLISHED"
        && item.publishAt !== null && Date.parse(item.publishAt) <= Date.now()));
    }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [retry]);
  return <main id="main-content" className="notice-page">
    <header className="notice-header"><Link href="/">Freelance Ops</Link><LanguageSelector /></header>
    <h1>{t("운영 공지")}</h1>
    <p>{t("서비스 운영에 관한 공지를 확인하세요.")}</p>
    {error ? <section role="alert"><p>{t("공지를 불러오지 못했습니다.")}</p><button type="button" onClick={() => { setError(false); setNotices(null); setRetry(value => value + 1); }}>{t("다시 확인")}</button></section>
      : notices === null ? <p role="status">{t("공지 불러오는 중…")}</p>
      : notices.length === 0 ? <p role="status" className="notice-card">{t("아직 게시된 운영 공지가 없습니다.")}</p>
      : notices.map(notice => <article className="notice-card" key={notice.id}>
        <h2>{notice.title}</h2>
        <p className="notice-meta">{t("버전")}: {notice.versionLabel} · {t("게시 시각")}: <time dateTime={notice.publishAt!}>{new Date(notice.publishAt!).toLocaleString()}</time></p>
        {notice.effectiveAt && <p className="notice-meta">{t("적용 시각")}: <time dateTime={notice.effectiveAt}>{new Date(notice.effectiveAt).toLocaleString()}</time></p>}
        <div className="notice-body">{notice.body}</div>
      </article>)}
    <Link href="/workspace">{t("로그인")}</Link>
  </main>;
}
