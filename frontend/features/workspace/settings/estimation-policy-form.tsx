import { useT } from "../../../app/lib/ui-language";
import { useRef, useState, type FormEvent } from "react";
import { AuthSession, EstimationPolicy, saveEstimationPolicy } from "../../../app/lib/api";
import { CircleNotch, CheckCircle, Receipt, ShieldCheck, Tag, Warning } from "@phosphor-icons/react";

interface EstimationPolicyFormProps {
  session: AuthSession;
  policy: EstimationPolicy;
  busy: boolean;
  error?: string | null;
  saved?: string | null;
  setBusy: (busy: boolean) => void;
  setError: (message: string | null) => void;
  setSaved: (message: string | null) => void;
  onSaved: (policy: EstimationPolicy) => void;
}

export function EstimationPolicyForm({ session, policy, busy, error, saved, setBusy, setError, setSaved, onSaved }: EstimationPolicyFormProps) {
  const t = useT();
  const pending = useRef(false);
  // 변경 대기·실패 중에도 백그라운드 조회로 정책이 갱신될 수 있다.
  const [submittedPolicy, setSubmittedPolicy] = useState<EstimationPolicy | null>(null);
  const formPolicy = submittedPolicy ?? policy;
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || pending.current) return;
    setError(null);
    setSaved(null);
    const data = new FormData(event.currentTarget);
    const values = ["taxRate", "bufferRate", "discountRate"].map((name) => String(data.get(name) ?? "").trim());
    if (values.some((value) => !value || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 100)) {
      setError("세율, 위험 대비율과 할인 한도를 0~100 사이의 숫자로 입력해 주세요.");
      return;
    }
    pending.current = true;
    setSubmittedPolicy(formPolicy);
    setBusy(true);
    try {
      const nextPolicy = await saveEstimationPolicy(session, {
        defaultTaxRate: Number(data.get("taxRate")) / 100,
        defaultRiskBufferRate: Number(data.get("bufferRate")) / 100,
        maximumDiscountRate: Number(data.get("discountRate")) / 100
      });
      onSaved(nextPolicy);
      setSubmittedPolicy(null);
      setSaved("견적 정책이 저장되었습니다.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "정책을 저장하지 못했습니다.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <form className="settings-form estimation-policy-form" key={formPolicy.version} aria-busy={busy} onSubmit={handleSubmit} onChange={() => setSaved(null)}>
      <fieldset className="settings-fields" disabled={busy}>
        <div className="estimation-policy-grid">
          <div className="estimation-policy-field">
            <label htmlFor="estimation-tax-rate"><Receipt size={21} aria-hidden="true" />{t("기본 세율 (%)")}</label>
            <p id="estimation-tax-help">{t("견적에 세율을 따로 지정하지 않았을 때 사용하는 기준입니다.")}</p>
            <div className="estimation-policy-control">
              <input
                id="estimation-tax-rate"
                aria-describedby="estimation-tax-help"
                name="taxRate"
                type="number"
                required
                min="0"
                max="100"
                step="0.1"
                defaultValue={formPolicy.defaultTaxRate * 100}
              />
              <span aria-hidden="true">%</span>
            </div>
          </div>
          <div className="estimation-policy-field">
            <label htmlFor="estimation-buffer-rate"><ShieldCheck size={21} aria-hidden="true" />{t("위험 대비율 (%)")}</label>
            <p id="estimation-buffer-help">{t("위험 대비 적용 시, 할인 후 항목 합계에 더합니다.")}</p>
            <div className="estimation-policy-control">
              <input
                id="estimation-buffer-rate"
                aria-describedby="estimation-buffer-help"
                name="bufferRate"
                type="number"
                required
                min="0"
                max="100"
                step="0.1"
                defaultValue={formPolicy.defaultRiskBufferRate * 100}
              />
              <span aria-hidden="true">%</span>
            </div>
          </div>
          <div className="estimation-policy-field">
            <label htmlFor="estimation-discount-rate"><Tag size={21} aria-hidden="true" />{t("최대 할인율 (%)")}</label>
            <p id="estimation-discount-help">{t("각 견적 항목에 적용할 수 있는 할인 한도입니다.")}</p>
            <div className="estimation-policy-control">
              <input
                id="estimation-discount-rate"
                aria-describedby="estimation-discount-help"
                name="discountRate"
                type="number"
                required
                min="0"
                max="100"
                step="0.1"
                defaultValue={formPolicy.maximumDiscountRate * 100}
              />
              <span aria-hidden="true">%</span>
            </div>
          </div>
        </div>
      </fieldset>
      {error && <div className="inline-error estimation-policy-feedback" role="alert"><Warning size={20} aria-hidden="true" />{t(error)}</div>}
      {saved && <div className="settings-saved estimation-policy-feedback" role="status"><CheckCircle size={20} aria-hidden="true" />{t(saved)}</div>}
      <div className="estimation-policy-footer">
        <p>{t("각 비율은 0~100% 범위에서 입력할 수 있습니다.")}</p>
        <button type="submit" className="primary-button estimation-policy-submit" disabled={busy}>
          {busy ? <CircleNotch className="spin" size={20} aria-hidden="true" /> : <CheckCircle size={20} aria-hidden="true" />}
          {busy ? t("저장 중…") : t("계산 기준 저장")}
        </button>
      </div>
    </form>
  );
}
