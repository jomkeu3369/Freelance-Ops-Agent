import { useT } from "../../../app/lib/ui-language";
import { useRef, type FormEvent } from "react";
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
  const t = useT();
  const pending = useRef(false);
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || pending.current) return;
    setError(null);
    setSaved(null);
    const data = new FormData(event.currentTarget);
    const values = ["taxRate", "bufferRate", "discountRate"].map(name => String(data.get(name) ?? "").trim());
    if (values.some(value => !value || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 100)) {
      setError("세율, 위험 대비율과 할인 한도를 0~100 사이의 숫자로 입력해 주세요.");
      return;
    }
    pending.current = true;
    setBusy(true);
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
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <form className="settings-form" key={policy.version} aria-busy={busy} onSubmit={handleSubmit}>
      <fieldset className="settings-fields" disabled={busy}>
        <div className="form-row">
          <label>
            {t("기본 세율 (%)")}<input
              name="taxRate"
              type="number"
              required
              min="0"
              max="100"
              step="0.1"
              defaultValue={policy.defaultTaxRate * 100}
            />
          </label>
          <label>
            {t("위험 대비율 (%)")}<input
              name="bufferRate"
              type="number"
              required
              min="0"
              max="100"
              step="0.1"
              defaultValue={policy.defaultRiskBufferRate * 100}
            />
          </label>
          <label>
            {t("최대 할인율 (%)")}<input
              name="discountRate"
              type="number"
              required
              min="0"
              max="100"
              step="0.1"
              defaultValue={policy.maximumDiscountRate * 100}
            />
          </label>
        </div>
        <button type="submit" className="primary-button" disabled={busy}>
          {busy ? <CircleNotch className="spin" /> : <CheckCircle size={18} />} {t("계산 기준 저장")}</button>
      </fieldset>
    </form>
  );
}
