import { useEffect, useState } from "react";
import { ShieldCheck } from "@phosphor-icons/react";
import { LiveWorkflow, snapshotFromEvents } from "@/app/components/live-workflow";
import { previewEvents, workflowSteps, workflowVisuals } from "../home-content";

function WorkflowStepVisual({ index }: { index: number }) {
  const visual = workflowVisuals[index];
  const Icon = visual.icon;
  return (
    <span className={`step-visual step-visual-${index + 1}`} aria-hidden="true">
      <span className="step-visual-nodes inputs">
        {visual.inputs.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </span>
      <span className="step-visual-core">
        <Icon size={28} weight="duotone" />
        <b>{visual.process}</b>
      </span>
      <span className="step-visual-nodes outputs">
        {visual.outputs.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </span>
    </span>
  );
}

export function WorkflowSection() {
  const [activeStep, setActiveStep] = useState(0);
  const [workflowPaused, setWorkflowPaused] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [userPaused, setUserPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(true);
  const [pageVisible, setPageVisible] = useState(true);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncMotion = () => setReducedMotion(preference.matches);
    const syncVisibility = () => setPageVisible(!document.hidden);
    syncMotion();
    syncVisibility();
    preference.addEventListener("change", syncMotion);
    document.addEventListener("visibilitychange", syncVisibility);
    return () => {
      preference.removeEventListener("change", syncMotion);
      document.removeEventListener("visibilitychange", syncVisibility);
    };
  }, []);

  useEffect(() => {
    if (workflowPaused || userPaused || reducedMotion || !pageVisible) {
      return;
    }
    const timer = window.setInterval(() => {
      setActiveStep((current) => (current + 1) % workflowSteps.length);
      setPreviewIndex((current) => (current + 1) % previewEvents.length);
    }, 2600);
    return () => window.clearInterval(timer);
  }, [workflowPaused, userPaused, reducedMotion, pageVisible]);

  const previewSnapshot = snapshotFromEvents(previewEvents.slice(0, previewIndex + 1), "PREVIEW");

  return (
    <section id="workflow" className="chapter workflow-chapter" data-paused={workflowPaused || userPaused || reducedMotion || !pageVisible}>
      <div className="section-heading">
        <p className="section-context">문의에서 제안까지</p>
        <h2>한 번의 문의가,<br />검토 가능한 제안서가 됩니다.</h2>
      </div>
      <div
        className="horizontal-accordion workflow-auto-sequence"
        role="group"
        aria-label="작동 단계 선택"
        onMouseEnter={() => setWorkflowPaused(true)}
        onMouseLeave={() => setWorkflowPaused(false)}
        onFocusCapture={() => setWorkflowPaused(true)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            setWorkflowPaused(false);
          }
        }}
      >
        {workflowSteps.map(([title, body], index) => (
          <button
            type="button"
            key={title}
            className={`accordion-slice ${activeStep === index ? "active" : ""}`}
            onMouseEnter={() => setActiveStep(index)}
            onFocus={() => setActiveStep(index)}
            onClick={() => setActiveStep(index)}
            aria-pressed={activeStep === index}
          >
            <span className="accordion-index">{index + 1}</span>
            <WorkflowStepVisual index={index} />
            <span className="accordion-content">
              <strong>{title}</strong>
              <p>{body}</p>
            </span>
          </button>
        ))}
      </div>
      <p className="workflow-note">
        <ShieldCheck size={19} /> 중요한 단계마다 사용자의 확인을 기다립니다.
      </p>
      <div className="workflow-live-preview">
        <div className="workflow-preview-toolbar">
          <div><span className="section-context">LIVE WALKTHROUGH</span><p>문의가 결과로 바뀌는 과정을 따라가 보세요.</p></div>
          <div className="workflow-preview-actions">
            <button
              type="button"
              className="quiet-button"
              aria-pressed={userPaused}
              disabled={reducedMotion}
              onClick={() => setUserPaused((paused) => !paused)}
            >
              {reducedMotion ? "동작 줄이기 적용 중" : userPaused ? "자동 재생" : "일시 정지"}
            </button>
            <button
              type="button"
              className="quiet-button"
              onClick={() => {
                setUserPaused(true);
                setPreviewIndex((current) => (current + 1) % previewEvents.length);
                setActiveStep((current) => (current + 1) % workflowSteps.length);
              }}
            >
              다음 단계
            </button>
          </div>
        </div>
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard users need to focus this horizontally scrollable region. */}
        <div className="workflow-preview-scroll" role="region" aria-label="제품 흐름 예시, 작은 화면에서는 가로로 스크롤할 수 있습니다" tabIndex={0}>
          <LiveWorkflow snapshot={previewSnapshot} preview />
        </div>
        <p className="workflow-preview-caption">제품 이해를 위한 예시입니다. 실제 분석은 업무 공간에서 시작합니다.<span>작은 화면에서는 좌우로 밀어 전체 흐름을 확인하세요.</span></p>
      </div>
    </section>
  );
}
