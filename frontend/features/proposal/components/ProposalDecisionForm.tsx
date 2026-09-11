import { FormEvent, useState } from "react";
import { ArrowRight, CheckCircle, CircleNotch } from "@phosphor-icons/react";
import { ApiError, submitProposalDecision } from "../../../app/lib/api";

type Decision = "APPROVED" | "CHANGES_REQUESTED" | "REJECTED";

function getDecisionMessage(decision: Decision) {
  if (decision === "APPROVED") return "제안을 승인했습니다.";
  if (decision === "CHANGES_REQUESTED") return "수정 요청을 전달했습니다.";
  return "제안을 거절했습니다.";
}

export default function ProposalDecisionForm({ token }: { token: string }) {
  const [decision, setDecision] = useState<Decision>("APPROVED");
  const [submitted, setSubmitted] = useState<Decision | null>(null);
  const [responseRecorded, setResponseRecorded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || responseRecorded) return;

    setBusy(true);
    setError(null);
    const data = new FormData(event.currentTarget);
    const clientName = String(data.get("clientName"));
    const clientEmail = String(data.get("clientEmail"));
    const comment = String(data.get("comment"));

    try {
      await submitProposalDecision(token, { decision, clientName, clientEmail, comment });
      setSubmitted(decision);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        setResponseRecorded(true);
        setError("이미 응답이 기록된 제안서입니다. 변경이 필요하면 담당자에게 문의해 주세요.");
      } else {
        setError(cause instanceof Error ? cause.message : "응답을 저장하지 못했습니다.");
      }
    } finally {
      setBusy(false);
    }
  }

  if (submitted) {
    return (
      <section className="proposal-decision">
        <div className="decision-complete">
          <CheckCircle size={38} />
          <span>응답이 기록되었습니다.</span>
          <h2>{getDecisionMessage(submitted)}</h2>
          <p>Freelance Ops가 응답 시각과 선택 내용을 안전하게 기록했습니다.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="proposal-decision">
      <div>
        <span>YOUR DECISION</span>
        <h2>이 제안에 대한 의견을 남겨주세요.</h2>
        <p>남겨주신 선택과 의견은 담당자에게 바로 전달됩니다.</p>
      </div>
      <form aria-busy={busy} onSubmit={handleSubmit}>
        <fieldset className="proposal-response-fields" disabled={busy || responseRecorded}>
          <div className="decision-options" role="group" aria-label="제안 응답">
            <button type="button" aria-pressed={decision === "APPROVED"} className={decision === "APPROVED" ? "active" : ""} onClick={() => setDecision("APPROVED")}>승인</button>
            <button type="button" aria-pressed={decision === "CHANGES_REQUESTED"} className={decision === "CHANGES_REQUESTED" ? "active" : ""} onClick={() => setDecision("CHANGES_REQUESTED")}>수정 요청</button>
            <button type="button" aria-pressed={decision === "REJECTED"} className={decision === "REJECTED" ? "active" : ""} onClick={() => setDecision("REJECTED")}>거절</button>
          </div>
          <div className="form-row">
            <label>이름<input name="clientName" required maxLength={120} /></label>
            <label>이메일<input name="clientEmail" type="email" maxLength={320} /></label>
          </div>
          <label>
            의견
            <textarea name="comment" rows={5} maxLength={3000} placeholder="승인 조건이나 수정이 필요한 내용을 남겨주세요." />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button type="submit" className="primary-button">
            {busy ? <CircleNotch className="spin" /> : <ArrowRight size={18} />}
            {" "}{busy ? "응답을 기록하고 있습니다." : "응답 제출"}
          </button>
        </fieldset>
      </form>
    </section>
  );
}
