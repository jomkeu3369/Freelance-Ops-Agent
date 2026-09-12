import {
  AuthSession,
  MeProfile,
  RateCard,
  EstimationPolicy,
  getMe,
  listRateCards,
  getEstimationPolicy,
} from "../../../app/lib/api";
import { useState, useRef, useEffect } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { CircleNotch, Warning, CheckCircle, ArrowRight } from "@phosphor-icons/react";
import { accountStatusLabels } from "../shared/constants";
import { RateCardManager } from "./rate-card-manager";
import { EstimationPolicyForm } from "./estimation-policy-form";

import { AIConnectionSettings } from "./ai-connection-settings";

gsap.registerPlugin(useGSAP);

interface SettingsPanelProps {
  session: AuthSession;
  permissions: Set<string>;
  projectCount: number;
  canCreateProject: boolean;
  onCreateProject: () => void;
  onOpenPipeline: () => void;
}

export function SettingsPanel({ session, permissions, projectCount, canCreateProject, onCreateProject, onOpenPipeline }: SettingsPanelProps) {
  const canReadQuotation = permissions.has("quotation.read");
  const canWriteQuotation = permissions.has("quotation.write");
  const canConnectAI = permissions.has("agent.run");
  const [profile, setProfile] = useState<MeProfile | null>(null);
  const [rateCards, setRateCards] = useState<RateCard[]>([]);
  const [policy, setPolicy] = useState<EstimationPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const onboardingRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([
      getMe(session),
      canReadQuotation ? listRateCards(session) : Promise.resolve([]),
      canReadQuotation ? getEstimationPolicy(session) : Promise.resolve(null)
    ])
      .then(([profileResult, cardsResult, policyResult]) => {
        if (cancelled) return;
        if (profileResult.status === "fulfilled") setProfile(profileResult.value);
        if (cardsResult.status === "fulfilled") setRateCards(cardsResult.value);
        if (policyResult.status === "fulfilled") setPolicy(policyResult.value);
        const failed = [profileResult, cardsResult, policyResult].find(
          (result) => result.status === "rejected"
        );
        if (failed?.status === "rejected")
          setError(
            failed.reason instanceof Error ? failed.reason.message : "일부 설정을 불러오지 못했습니다."
          );
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

  useGSAP(
    () => {
      if (loading || !onboardingRef.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches)
        return;
      gsap.fromTo(
        ".onboarding-step",
        { y: 18, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.55, stagger: 0.08, ease: "power3.out" }
      );
      gsap.fromTo(
        ".onboarding-progress-value",
        { scaleX: 0 },
        { scaleX: 1, duration: 0.8, ease: "power3.out", transformOrigin: "left center" }
      );
    },
    { scope: onboardingRef, dependencies: [loading, setupProgress], revertOnUpdate: true }
  );

  if (loading)
    return (
      <div className="section-loading">
        <CircleNotch className="spin" /> 작업 공간 설정을 확인하고 있습니다.
      </div>
    );

  return (
    <section className="settings-page">
      <div className="settings-heading">
        <span>작업 공간 설정</span>
        <h1>
          {onboardingComplete
            ? "견적 기준을 관리하세요."
            : hasActiveRateCard && policy
              ? "첫 고객 문의를 등록하세요."
              : "먼저 견적 기준을 정해볼까요?"}
        </h1>
        <p>자주 쓰는 단가와 계산 기준을 저장해 두면 새 견적을 만들 때 바로 불러올 수 있습니다.</p>
      </div>
      {error && (
        <div className="inline-error" role="alert">
          <Warning size={18} />
          {error}
        </div>
      )}
      {saved && (
        <div className="settings-saved" role="status">
          <CheckCircle size={18} />
          {saved}
        </div>
      )}
      <div className={`workspace-onboarding${onboardingComplete ? " complete" : ""}`} ref={onboardingRef}>
        <header>
          <div>
            <span>빠른 시작</span>
            <h2 id="workspace-onboarding-title">첫 견적을 만들 준비</h2>
            <p>
              {onboardingComplete
                ? "준비가 끝났습니다. 이제 고객 문의를 등록하고 견적을 시작해 보세요."
                : "필요한 항목을 순서대로 안내해 드립니다. 저장한 내용은 진행 상황에 바로 반영됩니다."}
            </p>
          </div>
          <strong aria-label={`온보딩 ${completedSetupCount}/${setupStates.length} 완료`}>
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
              <strong>작업 공간 확인</strong>
              <p>{setupStates[0] ? workspace?.name : "작업 공간 정보를 확인하고 있습니다."}</p>
            </div>
          </article>
          <article
            className={`onboarding-step${setupStates[1] ? " done" : !setupStates[0] ? "" : " current"}`}
            aria-current={!setupStates[1] && setupStates[0] ? "step" : undefined}
          >
            <span>{setupStates[1] ? <CheckCircle weight="fill" /> : "02"}</span>
            <div>
              <strong>서비스 단가 등록</strong>
              <p>
                {setupStates[1]
                  ? `${rateCards.filter((card) => card.active).length}개 단가 사용 중`
                  : "견적 계산에 사용할 시간·일·고정 단가를 등록하세요."}
              </p>
              {!setupStates[1] && canWriteQuotation && (
                <a href="#rate-cards">
                  단가 등록하기 <ArrowRight />
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
              <strong>계산 기준 확인</strong>
              <p>
                {setupStates[2]
                  ? `세율 ${Math.round(policy!.defaultTaxRate * 100)}% · 위험 대비율 ${Math.round(policy!.defaultRiskBufferRate * 100)}%`
                  : "세금과 위험 대비 기준을 확인하세요."}
              </p>
              {!setupStates[2] && canWriteQuotation && (
                <a href="#estimation-policy">
                  계산 기준 확인하기 <ArrowRight />
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
              <strong>첫 문의 등록</strong>
              <p>
                {setupStates[3]
                  ? `${projectCount}개 프로젝트 연결됨`
                  : "고객 원문을 등록해 실제 업무 흐름을 시작하세요."}
              </p>
              {!setupStates[3] && canCreateProject && (
                <button type="button" onClick={onCreateProject}>
                  문의 등록하기 <ArrowRight />
                </button>
              )}
            </div>
          </article>
        </div>
        {onboardingComplete && (
          <button type="button" className="secondary-button onboarding-finish" onClick={onOpenPipeline}>
            프로젝트 현황 보기 <ArrowRight size={17} />
          </button>
        )}
      </div>
      <div className="settings-grid">
        <aside className="settings-index" aria-label="작업 공간 설정 목차">
          <a href="#workspace-profile">
            <span>01</span>
            <strong>작업 공간</strong>
            <small>계정과 작업 공간</small>
          </a>
          <a href="#rate-cards">
            <span>02</span>
            <strong>서비스 단가</strong>
            <small>시간·일·고정 금액</small>
          </a>
          <a href="#estimation-policy">
            <span>03</span>
            <strong>계산 기준</strong>
            <small>세금·위험·할인 기준</small>
          </a>
          {canConnectAI && (
            <a href="#ai-connections">
              <span>04</span>
              <strong>AI 연결</strong>
              <small>내 API 키 관리</small>
            </a>
          )}
        </aside>
        <div className="settings-content">
          <section id="workspace-profile">
            <header>
              <span>01</span>
              <div>
                <h2>작업 공간</h2>
                <p>현재 로그인한 계정과 작업 공간을 확인합니다.</p>
              </div>
            </header>
            <dl>
              <div>
                <dt>작업 공간</dt>
                <dd>{workspace?.name ?? session.workspaceId}</dd>
              </div>
              <div>
                <dt>사용자</dt>
                <dd>{profile?.displayName ?? profile?.email ?? "-"}</dd>
              </div>
              <div>
                <dt>상태</dt>
                <dd>{profile ? (accountStatusLabels[profile.status] ?? "상태 확인 필요") : "-"}</dd>
              </div>
            </dl>
          </section>
          <section id="rate-cards">
            <header>
              <span>02</span>
              <div>
                <h2>서비스 단가</h2>
                <p>견적 계산에 사용할 시간·일·고정 금액 기준을 등록합니다.</p>
              </div>
            </header>
            <RateCardManager
              session={session}
              rateCards={rateCards}
              canWrite={canWriteQuotation}
              onChange={setRateCards}
            />
          </section>
          <section id="estimation-policy">
            <header>
              <span>03</span>
              <div>
                <h2>견적 계산 기준</h2>
                <p>견적에 기본으로 반영할 세금, 위험 대비율과 할인 한도를 정합니다.</p>
              </div>
            </header>
            {policy ? (
              canWriteQuotation ? (
                <EstimationPolicyForm
                  session={session}
                  policy={policy}
                  busy={busy}
                  setBusy={setBusy}
                  setError={setError}
                  setSaved={setSaved}
                  onSaved={setPolicy}
                />
              ) : (
                <dl>
                  <div>
                    <dt>기본 세율</dt>
                    <dd>{Math.round(policy.defaultTaxRate * 100)}%</dd>
                  </div>
                  <div>
                    <dt>위험 대비율</dt>
                    <dd>{Math.round(policy.defaultRiskBufferRate * 100)}%</dd>
                  </div>
                  <div>
                    <dt>최대 할인율</dt>
                    <dd>{Math.round(policy.maximumDiscountRate * 100)}%</dd>
                  </div>
                </dl>
              )
            ) : (
              <p>계산 기준을 확인할 수 없는 계정입니다.</p>
            )}
          </section>
          {canConnectAI && <AIConnectionSettings key={`${session.userId}:${session.workspaceId}`} session={session} />}
        </div>
      </div>
    </section>
  );
}
