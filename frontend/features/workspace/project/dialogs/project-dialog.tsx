import type { FormEvent } from "react";
import { Client } from "../../../../app/lib/api";
import { useRef, useState } from "react";
import { useDialogFocusTrap } from "../../shared/use-dialog-focus-trap";
import { Warning, CaretDown, CircleNotch, ArrowRight } from "@phosphor-icons/react";
import { currencyOptions } from "../../shared/constants";

interface ProjectDialogProps {
  clients: Client[];
  onClose: () => void;
  onCreate: (input: {
    clientId: string | null;
    title: string;
    requirementText: string;
    currency: string;
    deadline: string | null;
    budgetMin: number | null;
    budgetMax: number | null;
  }) => Promise<void>;
}

export function ProjectDialog({ clients, onClose, onCreate }: ProjectDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const optionalRef = useRef<HTMLDetailsElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalidField, setInvalidField] = useState<string | null>(null);
  useDialogFocusTrap(dialogRef, onClose, busy);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const title = String(data.get("title") ?? "").trim();
    const requirementText = String(data.get("requirementText") ?? "").trim();
    if (!title || !requirementText) {
      const field = !title ? "title" : "requirementText";
      setInvalidField(field);
      setError(
        !title
          ? "프로젝트 이름을 입력해 주세요. 공백만 입력할 수 없습니다."
          : "고객 문의 내용을 입력해 주세요. 공백만 입력할 수 없습니다."
      );
      form.querySelector<HTMLElement>(`[name="${field}"]`)?.focus();
      return;
    }
    const budgetMin = data.get("budgetMin") ? Number(data.get("budgetMin")) : null;
    const budgetMax = data.get("budgetMax") ? Number(data.get("budgetMax")) : null;
    if (budgetMin != null && budgetMax != null && budgetMin > budgetMax) {
      setInvalidField("budgetMax");
      setError("최대 예산은 최소 예산 이상으로 입력해 주세요.");
      if (optionalRef.current) optionalRef.current.open = true;
      form.querySelector<HTMLElement>('[name="budgetMax"]')?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    setInvalidField(null);
    try {
      await onCreate({
        clientId: String(data.get("clientId") ?? "") || null,
        title,
        requirementText,
        currency: String(data.get("currency") ?? "KRW"),
        deadline: String(data.get("deadline") ?? "") || null,
        budgetMin,
        budgetMax
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "프로젝트를 만들지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="project-dialog quick-intake-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-dialog-title"
        aria-describedby="project-dialog-description"
      >
        <div>
          <span>새 고객 문의</span>
          <button type="button" disabled={busy} onClick={onClose} aria-label="닫기">
            ×
          </button>
        </div>
        <h2 id="project-dialog-title">이름과 문의 내용으로 시작하세요.</h2>
        <p id="project-dialog-description">
          고객이 보낸 내용을 그대로 붙여 넣으세요. 고객 연결과 예산은 나중에 추가해도 됩니다.
        </p>
        {error && (
          <div id="project-dialog-error" className="inline-error" role="alert">
            <Warning size={18} />
            {error}
          </div>
        )}
        <form
          aria-busy={busy}
          onSubmit={handleSubmit}
          onInput={(event) => {
            if ((event.target as HTMLInputElement).name === invalidField) {
              setInvalidField(null);
              setError(null);
            }
          }}
        >
          <fieldset className="dialog-fields" disabled={busy}>
            <label>
              <span>
                프로젝트 이름 <small className="quick-intake-required">필수</small>
              </span>
              <input
                data-autofocus
                name="title"
                required
                maxLength={200}
                placeholder="예: 브랜드 사이트 리뉴얼"
                aria-invalid={invalidField === "title" || undefined}
                aria-describedby={invalidField === "title" ? "project-dialog-error" : undefined}
              />
            </label>
            <label>
              <span>
                고객 문의 원문 <small className="quick-intake-required">필수</small>
              </span>
              <textarea
                name="requirementText"
                required
                maxLength={50000}
                rows={6}
                placeholder="고객이 보낸 메시지나 현재 알고 있는 요구사항을 붙여 넣으세요."
                aria-invalid={invalidField === "requirementText" || undefined}
                aria-describedby={invalidField === "requirementText" ? "project-dialog-error" : undefined}
              />
            </label>
            <details
              ref={optionalRef}
              className="quick-intake-options"
              onInvalidCapture={() => {
                if (optionalRef.current) optionalRef.current.open = true;
              }}
            >
              <summary>
                <span>
                  추가 정보 <small>선택 · 고객, 예산, 일정</small>
                </span>
                <CaretDown size={18} aria-hidden="true" />
              </summary>
              <div className="quick-intake-option-fields">
                <label>
                  고객 연결
                  <select name="clientId" defaultValue="">
                    <option value="">아직 고객을 연결하지 않음</option>
                    {clients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.name}
                        {client.companyName ? ` · ${client.companyName}` : ""}
                      </option>
                    ))}
                  </select>
                  <small>
                    {clients.length === 0
                      ? "고객 연결 없이 먼저 시작할 수 있습니다."
                      : "선택한 고객은 프로젝트와 함께 저장됩니다."}
                  </small>
                </label>
                <div className="form-row">
                  <label>
                    통화
                    <select name="currency" defaultValue="KRW">
                      {currencyOptions.map((currency) => (
                        <option key={currency.value} value={currency.value}>
                          {currency.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    희망 완료일
                    <input name="deadline" type="date" />
                  </label>
                </div>
                <label>
                  예산 범위
                  <div className="budget-range">
                    <input
                      name="budgetMin"
                      type="number"
                      min="0"
                      step="any"
                      aria-label="최소 예산"
                      placeholder="최소"
                    />
                    <span>–</span>
                    <input
                      name="budgetMax"
                      type="number"
                      min="0"
                      step="any"
                      aria-label="최대 예산"
                      placeholder="최대"
                      aria-invalid={invalidField === "budgetMax" || undefined}
                      aria-describedby={invalidField === "budgetMax" ? "project-dialog-error" : undefined}
                    />
                  </div>
                </label>
              </div>
            </details>
            <div className="quick-intake-submit">
              <small>통화를 변경하지 않으면 원화(KRW)로 시작합니다.</small>
              <button className="primary-button" type="submit">
                {busy ? <CircleNotch className="spin" /> : <ArrowRight size={18} />}{" "}
                {busy ? "프로젝트를 만들고 있습니다." : "프로젝트 만들기"}
              </button>
            </div>
          </fieldset>
        </form>
      </section>
    </div>
  );
}
