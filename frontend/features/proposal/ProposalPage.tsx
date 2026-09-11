"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { CircleNotch, Printer, Warning } from "@phosphor-icons/react";
import { SharedProposal, getSharedProposal } from "../../app/lib/api";
import ProposalSummary from "./components/ProposalSummary";
import ProposalDecisionForm from "./components/ProposalDecisionForm";

export default function ProposalPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [proposal, setProposal] = useState<SharedProposal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadRevision, setLoadRevision] = useState(0);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    async function loadProposal() {
      try {
        const result = await getSharedProposal(token);
        if (!cancelled) {
          setProposal(result);
        }
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "제안서를 불러오지 못했습니다.");
        }
      }
    }

    void loadProposal();

    return () => {
      cancelled = true;
    };
  }, [loadRevision, token]);

  function retryLoading() {
    setError(null);
    setLoadRevision((current) => current + 1);
  }

  function printProposal() {
    window.print();
  }

  if (error && !proposal) {
    return (
      <main id="main-content" className="proposal-state">
        <Warning size={34} />
        <h1>제안서를 열 수 없습니다.</h1>
        <p>{error}</p>
        <div className="state-actions">
          <button type="button" className="primary-button" onClick={retryLoading}>다시 시도</button>
          <Link className="quiet-button" href="/">홈으로 이동</Link>
        </div>
      </main>
    );
  }

  if (!proposal) {
    return (
      <main id="main-content" className="proposal-state" aria-busy="true">
        <CircleNotch size={30} className="spin" />
        <p>제안서를 확인하고 있습니다.</p>
      </main>
    );
  }

  return (
    <main id="main-content" className="proposal-page">
      <header className="proposal-header">
        <Link href="/">Freelance Ops</Link>
        <div>
          <span>견적 제안서 · v{proposal.versionNumber}</span>
          <button type="button" onClick={printProposal}>
            <Printer size={17} /> PDF로 저장
          </button>
        </div>
      </header>
      <ProposalSummary proposal={proposal} />
      <ProposalDecisionForm token={token} />
      <footer className="proposal-footer">
        <span>Freelance Ops</span>
        <p>이 링크는 {new Date(proposal.shareExpiresAt).toLocaleDateString("ko-KR")}까지 유효합니다.</p>
      </footer>
    </main>
  );
}
