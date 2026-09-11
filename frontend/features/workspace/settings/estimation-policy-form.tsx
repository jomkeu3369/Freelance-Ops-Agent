import type { FormEvent } from "react";
import { AuthSession, EstimationPolicy, saveEstimationPolicy } from "../../../app/lib/api";
import { CircleNotch, CheckCircle } from "@phosphor-icons/react";

interface EstimationPolicyFormProps {
  session: AuthSession;
  policy: EstimationPolicy;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  setError: (message: string | null) => void;
  setSaved: (message: string | null) => void;
  onSaved: (policy: EstimationPolicy) => void;
}

export function EstimationPolicyForm({ session, policy, busy, setBusy, setError, setSaved, onSaved }: EstimationPolicyFormProps) {
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setSaved(null);
    const data = new FormData(event.currentTarget);
    try {
      const nextPolicy = await saveEstimationPolicy(session, {
        defaultTaxRate: Number(data.get("taxRate")) / 100,
        defaultRiskBufferRate: Number(data.get("bufferRate")) / 100,
        maximumDiscountRate: Number(data.get("discountRate")) / 100
      });
      onSaved(nextPolicy);
      setSaved("견적 정책이 저장되었습니다.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "정책을 저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="settings-form" key={policy.version} aria-busy={busy} onSubmit={handleSubmit}>
      <fieldset className="settings-fields" disabled={busy}>
        <div className="form-row">
          <label>
            기본 세율 (%)
            <input
              name="taxRate"
              type="number"
              min="0"
              max="100"
              step="0.1"
              defaultValue={policy.defaultTaxRate * 100}
            />
          </label>
          <label>
            위험 대비율 (%)
            <input
              name="bufferRate"
              type="number"
              min="0"
              max="100"
              step="0.1"
              defaultValue={policy.defaultRiskBufferRate * 100}
            />
          </label>
          <label>
            최대 할인율 (%)
            <input
              name="discountRate"
              type="number"
              min="0"
              max="100"
              step="0.1"
              defaultValue={policy.maximumDiscountRate * 100}
            />
          </label>
        </div>
        <button type="submit" className="primary-button" disabled={busy}>
          {busy ? <CircleNotch className="spin" /> : <CheckCircle size={18} />} 계산 기준 저장
        </button>
      </fieldset>
    </form>
  );
}
