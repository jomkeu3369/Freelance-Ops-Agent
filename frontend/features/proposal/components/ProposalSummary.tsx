import { FileText } from "@phosphor-icons/react";
import { SharedProposal } from "../../../app/lib/api";

function getUnitLabel(unit: string) {
  if (unit === "HOUR") return "시간";
  if (unit === "DAY") return "일";
  return "건";
}

export default function ProposalSummary({ proposal }: { proposal: SharedProposal }) {
  function formatMoney(value: number) {
    return new Intl.NumberFormat("ko-KR", { style: "currency", currency: proposal.currency, maximumFractionDigits: 0 }).format(value);
  }

  return (
    <>
      <section className="proposal-hero">
        <div>
          <span>{proposal.scenario} PROPOSAL</span>
          <h1>{proposal.projectTitle}</h1>
          <p>범위, 금액과 산정 근거를 확인한 뒤 아래에서 의사를 남겨주세요.</p>
        </div>
        <div className="proposal-total">
          <span>제안 금액</span>
          <strong>{formatMoney(proposal.total)}</strong>
          <small>유효 기간 {proposal.validUntil ?? "별도 협의"}</small>
        </div>
      </section>

      <section className="proposal-items">
        <div className="proposal-section-title">
          <FileText size={21} />
          <h2>작업 범위와 산정 근거</h2>
        </div>
        {proposal.items.map((item, index) => (
          <article key={`${item.title}-${index}`}>
            <div>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div>
                <h3>{item.title}</h3>
                <p>{item.description || "세부 설명은 협의된 요구사항을 따릅니다."}</p>
              </div>
            </div>
            <dl>
              <div><dt>공수</dt><dd>{item.quantity} {getUnitLabel(item.unit)}</dd></div>
              <div><dt>단가</dt><dd>{formatMoney(item.unitRate)}</dd></div>
              <div><dt>금액</dt><dd>{formatMoney(item.total)}</dd></div>
            </dl>
            <aside>
              <span>{item.basis.type === "EVIDENCE" ? "검증된 근거" : "확인할 가정"}</span>
              <p>{item.basis.content}</p>
            </aside>
          </article>
        ))}
      </section>

      <section className="proposal-calculation">
        <h2>금액 요약</h2>
        <dl>
          <div><dt>항목 합계</dt><dd>{formatMoney(proposal.subtotal)}</dd></div>
          <div><dt>할인</dt><dd>− {formatMoney(proposal.discountTotal)}</dd></div>
          <div><dt>위험 대비 금액</dt><dd>{formatMoney(proposal.riskBufferAmount)}</dd></div>
          <div><dt>세금</dt><dd>{formatMoney(proposal.taxAmount)}</dd></div>
          <div><dt>최종 합계</dt><dd>{formatMoney(proposal.total)}</dd></div>
        </dl>
      </section>
    </>
  );
}
