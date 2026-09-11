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

  useEffect(() => {
    const timer = window.setInterval(() => {
      setPreviewIndex((current) => (current + 1) % previewEvents.length);
    }, 1500);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (workflowPaused || reducedMotion) {
      return;
    }
    const timer = window.setInterval(() => {
      setActiveStep((current) => (current + 1) % workflowSteps.length);
    }, 1900);
    return () => window.clearInterval(timer);
  }, [workflowPaused]);

  const previewSnapshot = snapshotFromEvents(previewEvents.slice(0, previewIndex + 1), "PREVIEW");

  return (
    <section id="workflow" className="chapter workflow-chapter">
      <div className="section-heading">
        <p className="section-context">문의에서 제안까지</p>
        <h2>한 번의 문의가,<br />검토 가능한 제안서가 됩니다.</h2>
      </div>
      <div
        className="horizontal-accordion workflow-auto-sequence"
        role="list"
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
            aria-expanded={activeStep === index}
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
        <LiveWorkflow snapshot={previewSnapshot} preview />
      </div>
    </section>
  );
}
