import { AgentRunView } from "../../../../app/lib/api";
import { useRef, useState, useEffect, FormEvent } from "react";
import { parseInterruptionDraft, createInterruptionDraft } from "../../../../app/lib/interruption-draft.mjs";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { Trash, CircleNotch, ArrowRight } from "@phosphor-icons/react";

gsap.registerPlugin(useGSAP);

interface InterruptionFormProps {
  interruption: NonNullable<AgentRunView["interruption"]>;
  draftKey: string;
  draftWorkspaceId: string;
  draftRunId: string;
  busy: boolean;
  canRespond: boolean;
  onSubmit: (answers: string[]) => Promise<void>;
}

export function InterruptionForm({ interruption, draftKey, draftWorkspaceId, draftRunId, busy, canRespond, onSubmit }: InterruptionFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [answers, setAnswers] = useState<string[]>(() => {
    if (typeof window === "undefined") return interruption.questions.map(() => "");
    try {
      const raw = window.sessionStorage.getItem(draftKey);
      const draft = raw
        ? parseInterruptionDraft(raw, {
            workspaceId: draftWorkspaceId,
            runId: draftRunId,
            interruptionId: interruption.interruptionId,
            questions: interruption.questions
          })
        : null;
      return (draft?.answers as string[] | undefined) ?? interruption.questions.map(() => "");
    } catch {
      return interruption.questions.map(() => "");
    }
  });
  const hasDraft = answers.some((answer) => answer.length > 0);
  const pending = busy || submitting;

  useGSAP(
    () => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      gsap.from(formRef.current?.querySelectorAll("label") ?? [], {
        opacity: 0,
        y: 10,
        duration: 0.38,
        stagger: 0.06,
        ease: "power2.out",
        clearProps: "all"
      });
    },
    { scope: formRef, dependencies: [interruption.interruptionId] }
  );

  useEffect(() => {
    try {
      if (!hasDraft) {
        window.sessionStorage.removeItem(draftKey);
        return;
      }
      window.sessionStorage.setItem(
        draftKey,
        JSON.stringify(
          createInterruptionDraft({
            workspaceId: draftWorkspaceId,
            runId: draftRunId,
            interruptionId: interruption.interruptionId,
            questions: interruption.questions,
            answers
          })
        )
      );
    } catch {
      // Storage can be unavailable in privacy-restricted browser contexts.
    }
  }, [
    answers,
    draftKey,
    draftRunId,
    draftWorkspaceId,
    hasDraft,
    interruption.interruptionId,
    interruption.questions
  ]);

  const submitAnswers = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    setSubmitting(true);
    try {
      await onSubmit(answers.map((answer) => answer.trim()));
      try {
        window.sessionStorage.removeItem(draftKey);
      } catch {
        /* no-op */
      }
    } catch {
      // The parent exposes the API error; retaining the draft is the recovery path.
    } finally {
      setSubmitting(false);
    }
  };

  const clearDraft = () => {
    setAnswers(interruption.questions.map(() => ""));
    try {
      window.sessionStorage.removeItem(draftKey);
    } catch {
      /* no-op */
    }
  };

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    void submitAnswers(event);
  }

  return (
    <form ref={formRef} className="interruption-form" aria-busy={pending} onSubmit={handleSubmit}>
      <span>사용자 확인 필요</span>
      <h3>다음 내용을 확인해 주세요.</h3>
      {interruption.questions.map((question, index) => (
        <label key={question}>
          {question}
          <textarea
            required
            readOnly={!canRespond}
            value={answers[index]}
            onChange={(event) =>
              setAnswers((current) =>
                current.map((answer, answerIndex) => (answerIndex === index ? event.target.value : answer))
              )
            }
          />
        </label>
      ))}
      {canRespond ? (
        <div className="interruption-actions">
          <div aria-live="polite">
            {hasDraft
              ? "작성 중인 답변은 이 탭에 임시 저장됩니다."
              : "답변을 입력하면 이 탭에 임시 저장됩니다."}
          </div>
          <span>
            <button
              type="button"
              className="quiet-button"
              disabled={pending || !hasDraft}
              onClick={clearDraft}
            >
              <Trash size={16} /> 답변 지우기
            </button>
            <button
              type="submit"
              className="primary-button"
              disabled={pending || answers.some((answer) => !answer.trim())}
            >
              {pending ? <CircleNotch className="spin" /> : <ArrowRight />} 답변하고 계속
            </button>
          </span>
        </div>
      ) : (
        <p className="permission-note">이 실행에 답변할 권한이 없습니다.</p>
      )}
    </form>
  );
}
