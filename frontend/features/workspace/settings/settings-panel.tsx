import { useT } from "../../../app/lib/ui-language";
import {
  AuthSession,
  MeProfile,
  RateCard,
  EstimationPolicy,
  getMe,
  listRateCards,
  getEstimationPolicy,
} from "../../../app/lib/api";
import { useState, useEffect, useRef, type SetStateAction } from "react";
import { CircleNotch, Warning, CheckCircle, ArrowRight } from "@phosphor-icons/react";
import { accountStatusLabels } from "../shared/constants";
import { RateCardManager } from "./rate-card-manager";
import { EstimationPolicyForm } from "./estimation-policy-form";

import { FreeUsageStatus } from "../usage/free-usage-status";
import { AnalysisReturnLink } from "./analysis-return-link";
import { AIConnectionSettings } from "./ai-connection-settings";

interface SettingsPanelProps {
  session: AuthSession;
  permissions: Set<string>;
  projectCount: number;
  canCreateProject: boolean;
  onCreateProject: () => void;
  onOpenPipeline: () => void;
}

export function SettingsPanel({ session, permissions, projectCount, canCreateProject, onCreateProject, onOpenPipeline }: SettingsPanelProps) {
  const t = useT();
  const canReadQuotation = permissions.has("quotation.read");
  const canWriteQuotation = permissions.has("quotation.write");
  const canConnectAI = permissions.has("agent.run");
  const [profile, setProfile] = useState<MeProfile | null>(null);
  const [rateCards, setRateCards] = useState<RateCard[]>([]);
  const [policy, setPolicy] = useState<EstimationPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [readErrors, setReadErrors] = useState<{ profile: string | null; cards: string | null; policy: string | null }>({ profile: null, cards: null, policy: null });
  const [saved, setSaved] = useState<string | null>(null);
  // Cache invalidation does not cancel consumers of an already-running GET.
  const cardRevision = useRef(0);
  const policyRevision = useRef(0);
  const visibleError = error ?? readErrors.profile ?? readErrors.cards ?? readErrors.policy;

  function handleCardsSaved(update: SetStateAction<RateCard[]>) {
    cardRevision.current += 1;
    setRateCards(update);
    setReadErrors(current => ({ ...current, cards: null }));
  }

  function handlePolicySaved(value: EstimationPolicy) {
    policyRevision.current += 1;
    setPolicy(value);
    setReadErrors(current => ({ ...current, policy: null }));
  }

  useEffect(() => {
    let cancelled = false;
    const cardsAtStart = cardRevision.current;
    const policyAtStart = policyRevision.current;
    Promise.allSettled([
      getMe(session),
      canReadQuotation ? listRateCards(session) : Promise.resolve([]),
      canReadQuotation ? getEstimationPolicy(session) : Promise.resolve(null)
    ])
      .then(([profileResult, cardsResult, policyResult]) => {
        if (cancelled) return;
        const cardsCurrent = cardsAtStart === cardRevision.current;
        const policyCurrent = policyAtStart === policyRevision.current;
        if (profileResult.status === "fulfilled") setProfile(profileResult.value);
        if (cardsCurrent && cardsResult.status === "fulfilled") setRateCards(cardsResult.value);
        if (policyCurrent && policyResult.status === "fulfilled") setPolicy(policyResult.value);
        const readError = (result: PromiseSettledResult<unknown>) => result.status === "rejected"
          ? result.reason instanceof Error ? result.reason.message : "일부 설정을 불러오지 못했습니다."
          : null;
        setReadErrors(current => ({
          profile: readError(profileResult),
          cards: cardsCurrent ? readError(cardsResult) : current.cards,
          policy: policyCurrent ? readError(policyResult) : current.policy,
        }));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canReadQuotation, session]);

  const workspace = profile?.workspaces.find((item) => item.workspaceId === session.workspaceId);
  const hasActiveRateCard = rateCards.some((card) => card.active);
  const setupStates = [Boolean(workspace), hasActiveRateCard, Boolean(policy), projectCount > 0];
  const completedSetupCount = setupStates.filter(Boolean).length;
  const onboardingComplete = completedSetupCount === setupStates.length;
  const setupProgress = Math.round((completedSetupCount / setupStates.length) * 100);

  if (loading)
    return (
      <div className="section-loading" role="status" aria-busy="true">
        <CircleNotch className="spin" /> {t("작업 공간 설정을 확인하고 있습니다.")}</div>
    );

  return (
    <section className="settings-page">
      <AnalysisReturnLink />
      <div className="settings-heading">
        <span>{t("작업 공간 설정")}</span>
        <h1>{t("설정")}</h1>
        <p>{t("계정, AI 연결, 사용량과 견적 기준을 관리합니다.")}</p>
      </div>
      {visibleError && (
        <div className="inline-error" role="alert">
          <Warning size={18} />
          {t(visibleError)}
        </div>
      )}
      {saved && (
        <div className="settings-saved" role="status">
          <CheckCircle size={18} />
          {t(saved)}
        </div>
      )}
      <div className="settings-essentials settings-content">
        <FreeUsageStatus session={session} />
        {canConnectAI && <AIConnectionSettings key={`${session.userId}:${session.workspaceId}`} session={session} />}
      </div>
      {canReadQuotation && !visibleError && <details className="workspace-disclosure settings-quick-start">
        <summary>{t("빠른 시작")}<small>{t("온보딩 {v0}/{v1} 완료", { v0: completedSetupCount, v1: setupStates.length })}</small></summary>
      <div className={`workspace-onboarding${onboardingComplete ? " complete" : ""}`}>
        <header>
          <div>
            <span>{t("빠른 시작")}</span>
            <h2 id="workspace-onboarding-title">{t("첫 견적을 만들 준비")}</h2>
            <p>
              {onboardingComplete
                ? t("준비가 끝났습니다. 이제 고객 문의를 등록하고 견적을 시작해 보세요.")
                : t("필요한 항목을 순서대로 안내해 드립니다. 저장한 내용은 진행 상황에 바로 반영됩니다.")}
            </p>
          </div>
          <strong aria-label={t("온보딩 {v0}/{v1} 완료", { v0: completedSetupCount, v1: setupStates.length })}>
            {completedSetupCount}
            <small> / {setupStates.length}</small>
          </strong>
        </header>
        <div
          className="onboarding-progress"
          role="progressbar"
          aria-labelledby="workspace-onboarding-title"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={setupProgress}
        >
          <span className="onboarding-progress-value" style={{ width: `${setupProgress}%` }} />
        </div>
        <div className="onboarding-steps">
          <article
            className={`onboarding-step${setupStates[0] ? " done" : " current"}`}
            aria-current={!setupStates[0] ? "step" : undefined}
          >
            <span>{setupStates[0] ? <CheckCircle weight="fill" /> : "01"}</span>
            <div>
              <strong>{t("작업 공간 확인")}</strong>
              <p>{setupStates[0] ? workspace?.name : t("작업 공간 정보를 확인하고 있습니다.")}</p>
            </div>
          </article>
          <article
            className={`onboarding-step${setupStates[1] ? " done" : !setupStates[0] ? "" : " current"}`}
            aria-current={!setupStates[1] && setupStates[0] ? "step" : undefined}
          >
            <span>{setupStates[1] ? <CheckCircle weight="fill" /> : "02"}</span>
            <div>
              <strong>{t("서비스 단가 등록")}</strong>
              <p>
                {setupStates[1]
                  ? t("{v0}개 단가 사용 중", { v0: rateCards.filter((card) => card.active).length })
                  : t("견적 계산에 사용할 시간·일·고정 단가를 등록하세요.")}
              </p>
              {!setupStates[1] && canWriteQuotation && (
                <a href="#rate-cards">
                  {t("단가 등록하기")}<ArrowRight />
                </a>
              )}
            </div>
          </article>
          <article
            className={`onboarding-step${setupStates[2] ? " done" : setupStates[1] ? " current" : ""}`}
            aria-current={!setupStates[2] && setupStates[1] ? "step" : undefined}
          >
            <span>{setupStates[2] ? <CheckCircle weight="fill" /> : "03"}</span>
            <div>
              <strong>{t("계산 기준 확인")}</strong>
              <p>
                {setupStates[2]
                  ? t("세율 {v0}% · 위험 대비율 {v1}%", { v0: Math.round(policy!.defaultTaxRate * 100), v1: Math.round(policy!.defaultRiskBufferRate * 100) })
                  : t("세금과 위험 대비 기준을 확인하세요.")}
              </p>
              {!setupStates[2] && canWriteQuotation && (
                <a href="#estimation-policy">
                  {t("계산 기준 확인하기")}<ArrowRight />
                </a>
              )}
            </div>
          </article>
          <article
            className={`onboarding-step${setupStates[3] ? " done" : setupStates[2] ? " current" : ""}`}
            aria-current={!setupStates[3] && setupStates[2] ? "step" : undefined}
          >
            <span>{setupStates[3] ? <CheckCircle weight="fill" /> : "04"}</span>
            <div>
              <strong>{t("첫 문의 등록")}</strong>
              <p>
                {setupStates[3]
                  ? t("{v0}개 프로젝트 연결됨", { v0: projectCount })
                  : t("고객 원문을 등록해 실제 업무 흐름을 시작하세요.")}
              </p>
              {!setupStates[3] && canCreateProject && (
                <button type="button" onClick={onCreateProject}>
                  {t("문의 등록하기")}<ArrowRight />
                </button>
              )}
            </div>
          </article>
        </div>
        {onboardingComplete && (
          <button type="button" className="secondary-button onboarding-finish" onClick={onOpenPipeline}>
            {t("프로젝트 현황 보기")}<ArrowRight size={17} />
          </button>
        )}
      </div>
      </details>}
      <div className="settings-grid">
        <aside className="settings-index" aria-label={t("작업 공간 설정 목차")}>
          <a href="#workspace-profile">
            <span>01</span>
            <strong>{t("작업 공간")}</strong>
            <small>{t("계정과 작업 공간")}</small>
          </a>
          <a href="#rate-cards">
            <span>02</span>
            <strong>{t("서비스 단가")}</strong>
            <small>{t("시간·일·고정 금액")}</small>
          </a>
          <a href="#estimation-policy">
            <span>03</span>
            <strong>{t("계산 기준")}</strong>
            <small>{t("세금·위험·할인 기준")}</small>
          </a>
          {canConnectAI && (
            <a href="#ai-connections">
              <span>04</span>
              <strong>{t("AI 연결")}</strong>
              <small>{t("내 API 키 관리")}</small>
            </a>
          )}
        </aside>
        <div className="settings-content">
          <section id="workspace-profile">
            <header>
              <span>01</span>
              <div>
                <h2>{t("작업 공간")}</h2>
                <p>{t("현재 로그인한 계정과 작업 공간을 확인합니다.")}</p>
              </div>
            </header>
            <dl>
              <div>
                <dt>{t("작업 공간")}</dt>
                <dd>{workspace?.name ?? session.workspaceId}</dd>
              </div>
              <div>
                <dt>{t("사용자")}</dt>
                <dd>{profile?.displayName ?? profile?.email ?? "-"}</dd>
              </div>
              <div>
                <dt>{t("상태")}</dt>
                <dd>{profile ? (t(accountStatusLabels[profile.status]) ?? t("상태 확인 필요")) : "-"}</dd>
              </div>
            </dl>
          </section>
          <section id="rate-cards">
            <header>
              <span>02</span>
              <div>
                <h2>{t("서비스 단가")}</h2>
                <p>{t("자주 쓰는 단가와 계산 기준을 저장해 두면 새 견적을 만들 때 바로 불러올 수 있습니다.")}</p>
              </div>
            </header>
            {canReadQuotation ? <RateCardManager
              session={session}
              rateCards={rateCards}
              canWrite={canWriteQuotation}
              onChange={handleCardsSaved}
            /> : <p>{t("서비스 단가를 볼 권한이 없습니다.")}</p>}
          </section>
          <section id="estimation-policy">
            <header>
              <span>03</span>
              <div>
                <h2>{t("견적 계산 기준")}</h2>
                <p>{t("견적에 기본으로 반영할 세금, 위험 대비율과 할인 한도를 정합니다.")}</p>
              </div>
            </header>
            {canReadQuotation && policy ? (
              canWriteQuotation ? (
                <EstimationPolicyForm
                  session={session}
                  policy={policy}
                  busy={busy}
                  setBusy={setBusy}
                  setError={setError}
                  setSaved={setSaved}
                  onSaved={handlePolicySaved}
                />
              ) : (
                <dl>
                  <div>
                    <dt>{t("기본 세율")}</dt>
                    <dd>{Math.round(policy.defaultTaxRate * 100)}%</dd>
                  </div>
                  <div>
                    <dt>{t("위험 대비율")}</dt>
                    <dd>{Math.round(policy.defaultRiskBufferRate * 100)}%</dd>
                  </div>
                  <div>
                    <dt>{t("최대 할인율")}</dt>
                    <dd>{Math.round(policy.maximumDiscountRate * 100)}%</dd>
                  </div>
                </dl>
              )
            ) : (
              <p>{canReadQuotation ? t("계산 기준을 불러오지 못했습니다. 설정을 다시 열어 주세요.") : t("계산 기준을 볼 권한이 없습니다.")}</p>
            )}
          </section>
        </div>
      </div>
    </section>
  );
}
