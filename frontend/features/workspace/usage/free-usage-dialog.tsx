import { useCallback, useRef } from "react";
import { ApiError } from "../../../app/lib/api";
import { freeUsageResetLabel } from "../../../app/lib/free-usage.mjs";
import { useT, useUiLocale } from "../../../app/lib/ui-language";
import { useDialogFocusTrap } from "../shared/use-dialog-focus-trap";

export function FreeUsageDialog({ error, onClose, onRegister }: { error: ApiError; onClose: () => void; onRegister: () => void }) {
  const t = useT();
  const locale = useUiLocale();
  const dialog = useRef<HTMLElement>(null);
  const close = useCallback(() => {
    onClose();
    // The exhausted-credit response can disable the invoking Send button.
    requestAnimationFrame(() => {
      if (document.activeElement === document.body) document.querySelector<HTMLTextAreaElement>("#agent-chat-input:not(:disabled)")?.focus();
    });
  }, [onClose]);
  useDialogFocusTrap(dialog, close, false, true, true);
  const credits = error.metadata.unit === "CREDITS";
  const resetLabel = credits ? freeUsageResetLabel(error.metadata.resetAt, locale) : null;
  const safe = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  return <div className="free-usage-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <section ref={dialog} className="free-usage-dialog" role="dialog" aria-modal="true" aria-labelledby="free-usage-title" aria-describedby="free-usage-description" tabIndex={-1}>
      <h2 id="free-usage-title">{credits ? t("기본 AI 크레딧이 부족합니다") : t("사용량 확인 필요")}</h2>
      <p id="free-usage-description">{credits ? t("선택한 모델에 필요한 주간 크레딧이 부족하거나 진행 중인 요청에 예약되어 있습니다.") : t("주간 크레딧 정보를 확인하지 못했습니다. 사용량을 다시 확인해 주세요.")}</p>
      {credits && safe(error.metadata.requiredCredits) && safe(error.metadata.remaining) && <p>{t("{credits} 크레딧 필요 · {remaining} 크레딧 남음", { credits: error.metadata.requiredCredits, remaining: error.metadata.remaining })}</p>}
      {credits && safe(error.metadata.used) && safe(error.metadata.reserved) && <p>{t("사용 {used} · 예약 {reserved} 크레딧", { used: error.metadata.used, reserved: error.metadata.reserved })}</p>}
      {resetLabel && <p>{t("다음 초기화: {date} (한국 시간)", { date: resetLabel })}</p>}
      <p>{t("작성한 내용과 프로젝트는 그대로 보존됩니다. API 키를 등록해도 분석은 자동으로 시작되지 않습니다.")}</p>
      <p className="free-usage-warning">{t("개인 API 키로 실행하면 제공사 계정에 사용 요금이 청구됩니다. 연결 후 사용할 키를 선택하고 직접 분석을 시작하세요.")}</p>
      <p>{t("개인 키는 주간 크레딧을 차감하지 않지만 운영 보호한도와 지원 모델 제한은 적용됩니다.")}</p>
      <div className="free-usage-actions">
        <button type="button" className="secondary-button" data-autofocus onClick={close}>{t("닫기")}</button>
        <button type="button" className="primary-button" onClick={onRegister}>{t("API 등록하기")}</button>
      </div>
    </section>
  </div>;
}
