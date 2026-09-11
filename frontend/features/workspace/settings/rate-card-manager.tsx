import type { FormEvent } from "react";
import { AuthSession, RateCard, saveRateCard } from "../../../app/lib/api";
import { useState } from "react";
import { Plus, Warning, CheckCircle, CircleNotch, Archive, ArrowRight } from "@phosphor-icons/react";
import { formatMoney } from "../shared/formatters";

interface RateCardManagerProps {
  session: AuthSession;
  rateCards: RateCard[];
  canWrite: boolean;
  onChange: (cards: RateCard[]) => void;
}

export function RateCardManager({ session, rateCards, canWrite, onChange }: RateCardManagerProps) {
  const [editorId, setEditorId] = useState<string>("new");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const selected = rateCards.find((card) => card.id === editorId) ?? null;

  const replaceCard = (card: RateCard) => {
    const exists = rateCards.some((item) => item.id === card.id);
    const next = exists ? rateCards.map((item) => (item.id === card.id ? card : item)) : [...rateCards, card];
    onChange(next.sort((left, right) => left.name.localeCompare(right.name, "ko")));
  };

  const toggleActive = async () => {
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const card = await saveRateCard(session, selected.id, {
        name: selected.name,
        unit: selected.unit,
        rate: selected.rate,
        minimumAmount: selected.minimumAmount,
        currency: selected.currency,
        active: !selected.active
      });
      replaceCard(card);
      setConfirmDeactivate(false);
      setNotice(
        card.active
          ? "이 단가를 새 견적에서 다시 사용할 수 있습니다."
          : "이 단가를 새 견적의 선택 항목에서 제외했습니다."
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "단가 상태를 변경하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name")).trim();
    const rate = Number(data.get("rate"));
    const minimumAmount = Number(data.get("minimumAmount"));
    setError(null);
    setNotice(null);
    if (!name) {
      setError("서비스 이름을 입력해 주세요.");
      return;
    }
    if (!Number.isFinite(rate) || rate < 0 || !Number.isFinite(minimumAmount) || minimumAmount < 0) {
      setError("기본 단가와 최소 금액은 0 이상의 숫자여야 합니다.");
      return;
    }
    setBusy(true);
    try {
      const card = await saveRateCard(session, selected?.id ?? crypto.randomUUID(), {
        name,
        unit: String(data.get("unit")) as RateCard["unit"],
        rate,
        minimumAmount,
        currency: String(data.get("currency")),
        active: selected?.active ?? true
      });
      replaceCard(card);
      setEditorId(card.id);
      setNotice(selected ? "단가 변경을 저장했습니다." : "새 단가를 등록했습니다.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "단가를 저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rate-card-manager">
      <div className="rate-card-toolbar">
        <p>
          {rateCards.length === 0
            ? "등록된 단가가 없습니다. 첫 단가를 추가하세요."
            : `${rateCards.filter((card) => card.active).length}개 사용 중 · ${rateCards.length}개 전체`}
        </p>
        {canWrite && (
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              setEditorId("new");
              setError(null);
              setNotice(null);
              setConfirmDeactivate(false);
            }}
          >
            <Plus size={17} /> 새 단가
          </button>
        )}
      </div>
      {rateCards.length > 0 && (
        <div className="rate-card-list" aria-label="등록된 서비스 단가">
          {rateCards.map((card) => (
            <button
              type="button"
              key={card.id}
              aria-pressed={editorId === card.id}
              className={`${editorId === card.id ? "active" : ""}${card.active ? "" : " inactive"}`}
              onClick={() => {
                setEditorId(card.id);
                setError(null);
                setNotice(null);
                setConfirmDeactivate(false);
              }}
            >
              <div>
                <strong>{card.name}</strong>
                <small>{card.active ? "사용 중" : "비활성 · 기존 견적에는 유지"}</small>
              </div>
              <span>
                {formatMoney(card.rate, card.currency)} /{" "}
                {card.unit === "HOUR" ? "시간" : card.unit === "DAY" ? "일" : "건"}
                <small>최소 {formatMoney(card.minimumAmount, card.currency)}</small>
              </span>
            </button>
          ))}
        </div>
      )}

      {canWrite ? (
        <form
          className="settings-form rate-card-form"
          key={selected ? `${selected.id}-${selected.version}` : "new"}
          aria-busy={busy}
          onSubmit={handleSubmit}
        >
          <div className="rate-card-form-heading">
            <div>
              <strong>{selected ? "단가 편집" : "새 단가 등록"}</strong>
              <span>
                {selected ? `수정 이력 ${selected.version}` : "견적에 사용할 서비스와 금액을 입력하세요."}
              </span>
            </div>
            {selected && (
              <span className={selected.active ? "active" : "inactive"}>
                {selected.active ? "사용 중" : "비활성"}
              </span>
            )}
          </div>
          {error && (
            <div className="inline-error" role="alert">
              <Warning size={17} />
              {error}
            </div>
          )}
          {notice && (
            <div className="settings-saved" role="status">
              <CheckCircle size={17} />
              {notice}
            </div>
          )}
          <fieldset disabled={busy}>
            <div className="form-row">
              <label>
                서비스 이름
                <input
                  name="name"
                  required
                  maxLength={120}
                  placeholder="예: 개발 작업"
                  defaultValue={selected?.name ?? ""}
                />
              </label>
              <label>
                단위
                <select name="unit" defaultValue={selected?.unit ?? "HOUR"}>
                  <option value="HOUR">시간</option>
                  <option value="DAY">일</option>
                  <option value="FIXED">고정</option>
                </select>
              </label>
              <label>
                통화
                <select name="currency" defaultValue={selected?.currency ?? "KRW"}>
                  <option value="KRW">KRW</option>
                  <option value="USD">USD</option>
                  <option value="JPY">JPY</option>
                </select>
              </label>
            </div>
            <div className="form-row">
              <label>
                기본 단가
                <input
                  name="rate"
                  type="number"
                  min="0"
                  required
                  step="0.01"
                  defaultValue={selected?.rate ?? ""}
                />
              </label>
              <label>
                최소 금액
                <input
                  name="minimumAmount"
                  type="number"
                  min="0"
                  required
                  step="0.01"
                  defaultValue={selected?.minimumAmount ?? 0}
                />
              </label>
            </div>
            <div className="rate-card-form-actions">
              <button type="submit" className="primary-button">
                {busy ? <CircleNotch className="spin" /> : <CheckCircle size={18} />}{" "}
                {selected ? "변경 저장" : "단가 등록"}
              </button>
              {selected &&
                (selected.active ? (
                  confirmDeactivate ? (
                    <div className="archive-confirm">
                      <span>새 견적에서 이 단가를 숨길까요?</span>
                      <button type="button" onClick={() => void toggleActive()}>
                        비활성화
                      </button>
                      <button type="button" onClick={() => setConfirmDeactivate(false)}>
                        취소
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="quiet-button danger"
                      onClick={() => setConfirmDeactivate(true)}
                    >
                      <Archive size={17} /> 비활성화
                    </button>
                  )
                ) : (
                  <button type="button" className="quiet-button" onClick={() => void toggleActive()}>
                    <ArrowRight size={17} /> 다시 사용
                  </button>
                ))}
            </div>
          </fieldset>
        </form>
      ) : (
        <p className="permission-note">
          단가를 변경할 권한이 없습니다. 등록된 단가와 활성 상태만 확인할 수 있습니다.
        </p>
      )}
    </div>
  );
}
