import {useT} from '../../../../app/lib/ui-language';
import {byokCostEstimate} from '../../../../app/lib/byok-presentation.mjs';

export function ByokCostNotice({provider,model}:{provider:string;model:string}) {
  const t=useT();
  const estimate=byokCostEstimate(provider,model);
  if(!estimate) return <div className="chat-credit-notice byok-cost-notice" role="status">
    {t("이 개인 키 모델의 비용 기준을 확인하지 못했습니다. 다른 지원 모델을 직접 선택하기 전에는 실행하지 않습니다.")}
  </div>;
  return <div className="chat-credit-notice byok-cost-notice" role="status">
    <strong>{t("개인 키 · {model} · 표준 요금 기준 계산상 최대 ${amount}/실행 (USD)",{model,amount:estimate.maxUsd})}</strong>
    <span>{t("모든 시도 합계: 입력 15만·출력 4.8만 토큰, 최대 50회·180초. 완주를 보장하지 않으며 한도는 자동 증가하지 않습니다.")}</span>
    <small>{t("2026-10-05 표준 단가·입력 캐시 쓰기 요금 기준 추정입니다. 실제 사용량은 제공사 계정에 청구되며, 요금 변경·계정 조건·세금·환율에 따라 달라질 수 있습니다.")} <a href={estimate.sourceUrl} target="_blank" rel="noreferrer">{t("공식 요금 기준")}</a></small>
  </div>;
}
