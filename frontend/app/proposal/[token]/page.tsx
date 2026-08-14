"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowRight, CheckCircle, CircleNotch, FileText, Printer, Warning } from "@phosphor-icons/react";
import { SharedProposal, getSharedProposal, submitProposalDecision } from "../../lib/api";

type Decision = "APPROVED" | "CHANGES_REQUESTED" | "REJECTED";

export default function ProposalPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [proposal, setProposal] = useState<SharedProposal | null>(null);
  const [decision, setDecision] = useState<Decision>("APPROVED");
  const [submitted, setSubmitted] = useState<Decision | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadRevision, setLoadRevision] = useState(0);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    getSharedProposal(token)
      .then((result) => { if (!cancelled) setProposal(result); })
      .catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "제안서를 불러오지 못했습니다."); });
    return () => { cancelled = true; };
  }, [loadRevision, token]);

  if (error && !proposal) return <main id="main-content" className="proposal-state"><Warning size={34} /><h1>제안서를 열 수 없습니다.</h1><p>{error}</p><div className="state-actions"><button type="button" className="primary-button" onClick={() => { setError(null); setLoadRevision((current) => current + 1); }}>다시 시도</button><Link className="quiet-button" href="/">홈으로 이동</Link></div></main>;
  if (!proposal) return <main id="main-content" className="proposal-state" aria-busy="true"><CircleNotch size={30} className="spin" /><p>제안서를 확인하고 있습니다.</p></main>;

  const money = (value: number) => new Intl.NumberFormat("ko-KR", { style: "currency", currency: proposal.currency, maximumFractionDigits: 0 }).format(value);

  return (
    <main id="main-content" className="proposal-page">
      <header className="proposal-header"><Link href="/">Freelance Ops</Link><div><span>견적 제안서 · v{proposal.versionNumber}</span><button type="button" onClick={() => window.print()}><Printer size={17} /> PDF로 저장</button></div></header>
      <section className="proposal-hero">
        <div><span>{proposal.scenario} PROPOSAL</span><h1>{proposal.projectTitle}</h1><p>범위, 금액과 산정 근거를 확인한 뒤 아래에서 의사를 남겨주세요.</p></div>
        <div className="proposal-total"><span>제안 금액</span><strong>{money(proposal.total)}</strong><small>유효 기간 {proposal.validUntil ?? "별도 협의"}</small></div>
      </section>

      <section className="proposal-items">
        <div className="proposal-section-title"><FileText size={21} /><h2>작업 범위와 산정 근거</h2></div>
        {proposal.items.map((item, index) => <article key={`${item.title}-${index}`}>
          <div><span>{String(index + 1).padStart(2, "0")}</span><div><h3>{item.title}</h3><p>{item.description || "세부 설명은 협의된 요구사항을 따릅니다."}</p></div></div>
          <dl><div><dt>공수</dt><dd>{item.quantity} {item.unit === "HOUR" ? "시간" : item.unit === "DAY" ? "일" : "건"}</dd></div><div><dt>단가</dt><dd>{money(item.unitRate)}</dd></div><div><dt>금액</dt><dd>{money(item.total)}</dd></div></dl>
          <aside><span>{item.basis.type === "EVIDENCE" ? "검증된 근거" : "확인할 가정"}</span><p>{item.basis.content}</p></aside>
        </article>)}
      </section>

      <section className="proposal-calculation"><h2>금액 요약</h2><dl><div><dt>항목 합계</dt><dd>{money(proposal.subtotal)}</dd></div><div><dt>할인</dt><dd>− {money(proposal.discountTotal)}</dd></div><div><dt>위험 대비 금액</dt><dd>{money(proposal.riskBufferAmount)}</dd></div><div><dt>세금</dt><dd>{money(proposal.taxAmount)}</dd></div><div><dt>최종 합계</dt><dd>{money(proposal.total)}</dd></div></dl></section>

      <section className="proposal-decision">
        {submitted ? <div className="decision-complete"><CheckCircle size={38} /><span>응답이 기록되었습니다.</span><h2>{submitted === "APPROVED" ? "제안을 승인했습니다." : submitted === "CHANGES_REQUESTED" ? "수정 요청을 전달했습니다." : "제안을 거절했습니다."}</h2><p>Freelance Ops가 응답 시각과 선택 내용을 안전하게 기록했습니다.</p></div> : <>
          <div><span>YOUR DECISION</span><h2>이 제안에 대한 의견을 남겨주세요.</h2><p>남겨주신 선택과 의견은 담당자에게 바로 전달됩니다.</p></div>
          <form aria-busy={busy} onSubmit={async (event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            if (busy) return;
            setBusy(true);
            setError(null);
            const data = new FormData(event.currentTarget);
            try {
              await submitProposalDecision(token, { decision, clientName: String(data.get("clientName")), clientEmail: String(data.get("clientEmail")), comment: String(data.get("comment")) });
              setSubmitted(decision);
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "응답을 저장하지 못했습니다.");
            } finally {
              setBusy(false);
            }
          }}>
            <fieldset className="proposal-response-fields" disabled={busy}>
              <div className="decision-options" role="group" aria-label="제안 응답"><button type="button" aria-pressed={decision === "APPROVED"} className={decision === "APPROVED" ? "active" : ""} onClick={() => setDecision("APPROVED")}>승인</button><button type="button" aria-pressed={decision === "CHANGES_REQUESTED"} className={decision === "CHANGES_REQUESTED" ? "active" : ""} onClick={() => setDecision("CHANGES_REQUESTED")}>수정 요청</button><button type="button" aria-pressed={decision === "REJECTED"} className={decision === "REJECTED" ? "active" : ""} onClick={() => setDecision("REJECTED")}>거절</button></div>
              <div className="form-row"><label>이름<input name="clientName" required maxLength={120} /></label><label>이메일<input name="clientEmail" type="email" maxLength={320} /></label></div>
              <label>의견<textarea name="comment" rows={5} maxLength={3000} placeholder="승인 조건이나 수정이 필요한 내용을 남겨주세요." /></label>
              {error && <p className="form-error" role="alert">{error}</p>}
              <button type="submit" className="primary-button">{busy ? <CircleNotch className="spin" /> : <ArrowRight size={18} />} {busy ? "응답을 기록하고 있습니다." : "응답 제출"}</button>
            </fieldset>
          </form>
        </>}
      </section>
      <footer className="proposal-footer"><span>Freelance Ops</span><p>이 링크는 {new Date(proposal.shareExpiresAt).toLocaleDateString("ko-KR")}까지 유효합니다.</p></footer>
    </main>
  );
}
