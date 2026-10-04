import type { AIConnection, Provider } from "../../../../app/lib/api";
import { useT } from "../../../../app/lib/ui-language";
import { configuredModelOptions } from "../../shared/constants";

export function ChatModelControls({ connections, credentialId, provider, model, busy, connectionError, onCredentialChange, onProviderChange, onModelChange }: {
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
  const connection = connections.find(item => item.id === credentialId);
  return <div className="run-controls">
    <label>{t("AI 연결")}<select value={credentialId} disabled={busy} onChange={event => onCredentialChange(event.target.value)}>
      <option value="">{t("기본 제공 AI")}</option>
      {connections.map(item => <option key={item.id} value={item.id}>{t("내 키 ·")}{item.provider} · {item.model} · {item.maskedKey}</option>)}
    </select></label>
    {connectionError && <span role="alert">{t("개인 연결을 확인하지 못했습니다. 설정에서 다시 확인해 주세요.")}</span>}
    {credentialId && !connection && <span role="alert">{t("선택한 연결을 사용할 수 없습니다. 설정에서 연결을 확인하거나 사용할 AI를 다시 선택해 주세요.")}</span>}
    {!credentialId && <>
      <label>{t("AI 제공사")}<select value={provider} disabled={busy} onChange={event => onProviderChange(event.target.value as Provider)}><option value="OPENAI">OpenAI</option></select></label>
      <label>{t("AI 모델")}<select value={model} disabled={busy || configuredModelOptions[provider].length === 0} onChange={event => onModelChange(event.target.value)}>
        {configuredModelOptions[provider].length === 0 ? <option value="">{t("등록된 모델 없음")}</option> : configuredModelOptions[provider].map(option => <option key={option} value={option}>{option}</option>)}
      </select></label>
    </>}
    <span className="model-selection-note">{credentialId ? t("내 키로 실행 · 제공사 계정에 청구") : t("기본 제공 AI로 실행")} {t("· 자동 전환 없음")}</span>
  </div>;
}
