import { useRef } from "react";
import { ApiError } from "../../../app/lib/api";
import { freeUsageResetLabel } from "../../../app/lib/free-usage.mjs";
import { useT, useUiLocale } from "../../../app/lib/ui-language";
import { useDialogFocusTrap } from "../shared/use-dialog-focus-trap";

export function FreeUsageDialog({ error, onClose, onRegister }: { error: ApiError; onClose: () => void; onRegister: () => void }) {
  const t = useT();
  const locale = useUiLocale();
  const dialog = useRef<HTMLElement>(null);
  useDialogFocusTrap(dialog, onClose, false, true, true);
  const resetLabel = freeUsageResetLabel(error.metadata.resetAt, locale);
  return <div className="free-usage-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialog} className="free-usage-dialog" role="dialog" aria-modal="true" aria-labelledby="free-usage-title" aria-describedby="free-usage-description" tabIndex={-1}>
      <h2 id="free-usage-title">{t("더 이용하려면 API를 등록하세요!")}</h2>
      <p id="free-usage-description">{t("이번 달 무료 분석을 모두 사용했거나 남은 횟수가 진행 중인 분석에 예약되어 있습니다.")}</p>
      {typeof error.metadata.used === "number" && typeof error.metadata.limit === "number" && <p>{t("사용 {used} / 월 {limit}회", { used: error.metadata.used, limit: error.metadata.limit })}{typeof error.metadata.reserved === "number" && <> · {t("예약 {reserved}회", { reserved: error.metadata.reserved })}</>}</p>}
      {resetLabel && <p>{t("다음 초기화: {date} (한국 시간)", { date: resetLabel })}</p>}
      <p>{t("작성한 내용과 프로젝트는 그대로 보존됩니다. API 키를 등록해도 분석은 자동으로 시작되지 않습니다.")}</p>
      <p className="free-usage-warning">{t("개인 API 키로 실행하면 제공사 계정에 사용 요금이 청구됩니다. 연결 후 사용할 키를 선택하고 직접 분석을 시작하세요.")}</p>
      <div className="free-usage-actions">
        <button type="button" className="secondary-button" data-autofocus onClick={onClose}>{t("닫기")}</button>
        <button type="button" className="primary-button" onClick={onRegister}>{t("API 등록하기")}</button>
      </div>
    </section>
  </div>;
}
