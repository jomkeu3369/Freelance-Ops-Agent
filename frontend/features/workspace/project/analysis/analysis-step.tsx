import { AuthSession, AgentRunView, AgentRunUsage, WorkflowEvent } from "../../../../app/lib/api";
import { LiveWorkflow, snapshotFromEvents } from "../../../../app/components/live-workflow";
import { interruptionDraftKey } from "../../../../app/lib/interruption-draft.mjs";
import { ArrowRight, CircleNotch, Clock, Graph, Warning } from "@phosphor-icons/react";
import { runStatusLabels } from "../../shared/constants";
import { runFailureMessage } from "../../shared/activity-presentation";
import { InterruptionForm } from "./interruption-form";
import { AnalysisTimeline } from "./analysis-timeline";
import { AnalysisResult } from "./analysis-result";

interface AnalysisStepProps {
  session: AuthSession;
  run: AgentRunView | null;
  runId: string | null;
  events: WorkflowEvent[];
  busy: boolean;
  snapshot: ReturnType<typeof snapshotFromEvents>;
  canCancel: boolean;
  canRespond: boolean;
  reviewFocused: boolean;
  costUsage: AgentRunUsage | null;
  onToggleFocus: () => void;
  onCancel: () => Promise<void>;
  onResume: (answers: string[]) => Promise<void>;
  onCompareQuotes: () => void;
}

export function AnalysisStep({ session, run, runId, events, busy, snapshot, canCancel, canRespond, reviewFocused, costUsage, onToggleFocus, onCancel, onResume, onCompareQuotes }: AnalysisStepProps) {
  function handleCancel() {
    void onCancel();
  }

  return (
    <div className={`workbench-grid${reviewFocused ? " review-focused" : ""}`}>
      <div id="run-execution-graph" className="graph-panel" hidden={reviewFocused}>
        <LiveWorkflow snapshot={snapshot} />
        {runId &&
          canCancel &&
          (!run || ["QUEUED", "RUNNING", "WAITING_FOR_USER"].includes(run.status)) && (
            <div className="run-action-bar">
              <span>필요하면 현재 실행을 안전하게 중단할 수 있습니다.</span>
              <button
                type="button"
                className="quiet-button danger"
                disabled={busy}
                onClick={handleCancel}
              >
                {busy ? <CircleNotch className="spin" /> : <Warning size={17} />} 실행 중단
              </button>
            </div>
          )}
        <AnalysisTimeline events={events} run={run} />
      </div>

      <aside className="run-inspector">
        <div className="panel-title inspector-title">
          <span>분석 결과</span>
          <div>
            {run && (
              <small className="run-status-chip">{runStatusLabels[run.status] ?? run.status}</small>
            )}
            <button
              type="button"
              className="panel-focus-toggle"
              aria-controls="run-execution-graph"
              aria-expanded={!reviewFocused}
              onClick={onToggleFocus}
            >
              {reviewFocused ? (
                <>
                  <Graph size={16} /> 진행 상황 보기
                </>
              ) : (
                <>
                  결과 크게 보기 <ArrowRight size={15} />
                </>
              )}
            </button>
          </div>
        </div>
        {!run ? (
          <div className="inspector-empty">
            <Clock size={26} />
            <p>실행 결과와 확인 질문이 여기에 나타납니다.</p>
          </div>
        ) : run.status === "WAITING_FOR_USER" && run.interruption ? (
          <InterruptionForm
            key={run.interruption.interruptionId}
            interruption={run.interruption}
            draftKey={interruptionDraftKey(session.userId, session.workspaceId, runId ?? run.runId, run.interruption.interruptionId)}
            draftWorkspaceId={session.workspaceId}
            draftRunId={runId ?? run.runId}
            busy={busy}
            canRespond={canRespond}
            onSubmit={onResume}
          />
        ) : ["FAILED", "CANCELLED"].includes(run.status) ? (
          <div className="run-failed">
            <Warning size={30} />
            <h3>
              {run.status === "CANCELLED" ? "사용자가 실행을 중단했습니다." : "실행이 중단되었습니다."}
            </h3>
            <p>
              {run.status === "CANCELLED"
                ? "저장된 프로젝트와 이전 결과는 변경되지 않습니다."
                : runFailureMessage(run.errorCode)}
            </p>
            {run.status === "FAILED" && run.errorCode && <small>오류 코드 · {run.errorCode}</small>}
          </div>
        ) : run.result ? (
          <AnalysisResult run={run} events={events} costUsage={costUsage} onCompareQuotes={onCompareQuotes} />
        ) : (
          <div className="inspector-empty running">
            <CircleNotch size={29} className="spin" />
            <p>결과를 만들고 있습니다. 그래프에서 현재 단계를 확인하세요.</p>
          </div>
        )}
      </aside>
    </div>
  );
}
