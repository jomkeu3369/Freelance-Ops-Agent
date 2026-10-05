import { ByokCostNotice } from "./byok-cost-notice";
import type { AIConnection, Provider } from "../../../../app/lib/api";
import { useT } from "../../../../app/lib/ui-language";
import type { AiUsageModel } from "../../../../app/lib/ai-usage-presentation";

export function ChatModelControls({ catalogModels, connections, credentialId, provider, model, busy, connectionError, onCredentialChange, onProviderChange, onModelChange }: {
  catalogModels: AiUsageModel[] | null;
  connections: AIConnection[];
  credentialId: string;
  provider: Provider;
  model: string;
  busy: boolean;
  connectionError: boolean;
  onCredentialChange: (value: string) => void;
  onProviderChange: (value: Provider) => void;
  onModelChange: (value: string) => void;
}) {
  const t = useT();
  const options = catalogModels?.filter(item => item.provider === provider) ?? [];
  const selected = options.find(item => item.model === model);
  const connection = connections.find(item => item.id === credentialId);
  return <div className="run-controls">
    <label>{t("AI 연결")}<select aria-label={t("AI 연결")} value={credentialId} disabled={busy} onChange={event => onCredentialChange(event.target.value)}>
      <option value="">{t("기본 제공 AI")}</option>
      {connections.map(item => <option key={item.id} value={item.id}>{t("내 키 ·")}{item.provider} · {item.model} · {item.maskedKey}</option>)}
    </select></label>
    {connectionError && <span role="alert">{t("개인 연결을 확인하지 못했습니다. 설정에서 다시 확인해 주세요.")}</span>}
    {credentialId && !connection && <span role="alert">{t("선택한 연결을 사용할 수 없습니다. 설정에서 연결을 확인하거나 사용할 AI를 다시 선택해 주세요.")}</span>}
    {!credentialId && <>
      <label>{t("AI 제공사")}<select aria-label={t("AI 제공사")} value={provider} disabled={busy} onChange={event => onProviderChange(event.target.value as Provider)}><option value="OPENAI">OpenAI</option></select></label>
      <label>{t("AI 모델")}<select aria-label={t("AI 모델")} value={model} disabled={busy || catalogModels === null || options.length === 0} onChange={event => onModelChange(event.target.value)}>
        {!options.some(rate => rate.model === model) && <option value={model} disabled>{model || t("등록된 모델 없음")} · {t("가격 확인 필요")}</option>}
        {options.map(item => <option key={item.model} value={item.model} disabled={!item.catalogued || !item.enabled || !item.available || item.maxRunUsd === null}>{item.model}{!item.available || !item.enabled || !item.catalogued || item.maxRunUsd === null ? ` · ${t("현재 이용 불가")}` : ""}</option>)}
      </select></label>
      {selected && <div className="model-selection-note">
        <p>{selected.maxRunUsd === null ? t("예약 상한 확인 필요") : t("요청당 예약 상한 ${amount} (USD) · 예상 실제 비용이 아닙니다.", { amount: selected.maxRunUsd })}</p>
        {!selected.providerAccessVerified && <p>{t("제공사 계정의 모델 접근 권한은 아직 확인되지 않았습니다.")}</p>}
        <p>{t("지원 추론 수준: {efforts}", { efforts: selected.reasoningEfforts.join(", ") || "—" })}</p>
        {(!selected.available || !selected.enabled || !selected.catalogued) && <p role="status">{selected.unavailableReason || t("현재 이용 불가")}</p>}
      </div>}
      {catalogModels === null && <span role="status">{t("사용량과 모델 지원 상태를 확인하지 못했습니다.")}</span>}
    </>}
    {credentialId && connection && <ByokCostNotice provider={connection.provider} model={connection.model} />}
    {credentialId && <span className="model-selection-note">{t("선택한 OpenAI 키로만 모델을 호출하며 제공사 계정에 청구됩니다. 라우팅과 자료 조회에는 플랫폼 AI를 사용하지 않습니다.")}</span>}
    {credentialId && <span className="model-selection-note">{t("유료 웹 검색·임베딩·별도 AI 생성은 지원하지 않습니다. 실행 시간은 대기 중에도 연장되지 않고, 실패·재시도도 실행 한도에 포함됩니다.")}</span>}
    <span className="model-selection-note">{credentialId ? t("내 키로 실행 · 제공사 계정에 청구") : t("기본 제공 AI로 실행")} {t("· 자동 전환 없음")}</span>
  </div>;
}
