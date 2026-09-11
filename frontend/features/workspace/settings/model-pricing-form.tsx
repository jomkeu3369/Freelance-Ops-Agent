import type { FormEvent } from "react";
import { AuthSession, ModelPricing, createModelPricing, Provider } from "../../../app/lib/api";
import { suggestedModelOptions, currencyOptions } from "../shared/constants";
import { CircleNotch, Plus } from "@phosphor-icons/react";

interface ModelPricingFormProps {
  session: AuthSession;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  setError: (message: string | null) => void;
  setSaved: (message: string | null) => void;
  onCreated: (pricing: ModelPricing) => void;
}

export function ModelPricingForm({ session, busy, setBusy, setError, setSaved, onCreated }: ModelPricingFormProps) {
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const validFrom = new Date(String(data.get("validFrom")));
    const validUntilRaw = String(data.get("validUntil"));
    const validUntil = validUntilRaw ? new Date(validUntilRaw) : null;
    setError(null);
    setSaved(null);
    if (validUntil && validUntil <= validFrom) {
      setError("가격 유효 종료 시점은 시작 시점보다 늦어야 합니다.");
      return;
    }
    setBusy(true);
    try {
      const pricing = await createModelPricing(session, {
        provider: String(data.get("provider")) as Provider,
        model: String(data.get("model")).trim(),
        versionLabel: String(data.get("versionLabel")).trim(),
        currency: String(data.get("currency")),
        inputPerMillion: Number(data.get("inputPerMillion")),
        cachedInputPerMillion: Number(data.get("cachedInputPerMillion")),
        outputPerMillion: Number(data.get("outputPerMillion")),
        validFrom: validFrom.toISOString(),
        validUntil: validUntil?.toISOString() ?? null
      });
      onCreated(pricing);
      setSaved("AI 모델 요금을 등록했습니다.");
      form.reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "모델 가격을 등록하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="settings-form model-pricing-form" aria-busy={busy} onSubmit={handleSubmit}>
      <fieldset className="settings-fields" disabled={busy}>
        <div className="form-row">
          <label>
            AI 제공사
            <select name="provider" defaultValue="OPENAI">
              <option value="OPENAI">OpenAI</option>
              <option value="GEMINI">Gemini</option>
            </select>
          </label>
          <label>
            모델
            <input
              name="model"
              list="suggested-models"
              required
              maxLength={100}
              placeholder="목록에서 선택하거나 모델명 입력"
            />
            <datalist id="suggested-models">
              {suggestedModelOptions.map((model) => (
                <option key={model} value={model} />
              ))}
            </datalist>
          </label>
          <label>
            요금 기준 이름
            <input name="versionLabel" required maxLength={100} placeholder="예: 2026년 8월 공식 요금" />
          </label>
          <label>
            통화
            <select name="currency" defaultValue="USD">
              {currencyOptions.map((currency) => (
                <option key={currency.value} value={currency.value}>
                  {currency.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="form-row">
          <label>
            입력 100만 토큰
            <input name="inputPerMillion" type="number" min="0" step="0.000001" required />
          </label>
          <label>
            캐시 입력 100만 토큰
            <input name="cachedInputPerMillion" type="number" min="0" step="0.000001" required />
          </label>
          <label>
            출력 100만 토큰
            <input name="outputPerMillion" type="number" min="0" step="0.000001" required />
          </label>
        </div>
        <div className="form-row">
          <label>
            적용 시작
            <input name="validFrom" type="datetime-local" required />
          </label>
          <label>
            적용 종료
            <input name="validUntil" type="datetime-local" />
          </label>
        </div>
        <button type="submit" className="secondary-button" disabled={busy}>
          {busy ? <CircleNotch className="spin" /> : <Plus size={18} />} AI 요금 등록
        </button>
      </fieldset>
    </form>
  );
}
