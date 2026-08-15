"use client";

import {
  Brain,
  Calculator,
  CheckCircle,
  FileText,
  MagnifyingGlass,
  Question,
  ShareNetwork,
} from "@phosphor-icons/react";
import type { AgentRunStatus, WorkflowEvent } from "../lib/api";

export type WorkflowNodeId =
  | "intake"
  | "routing"
  | "context"
  | "analysis"
  | "evidence"
  | "quotation"
  | "review";

export interface WorkflowSnapshot {
  activeNode: WorkflowNodeId;
  completedNodes: WorkflowNodeId[];
  failedNode?: WorkflowNodeId;
  status: AgentRunStatus | "PREVIEW" | "IDLE";
  eventLabel: string;
  eventCount: number;
}

const nodes = [
  { id: "intake" as const, label: "문의 등록", icon: FileText },
  { id: "routing" as const, label: "경로 판단", icon: ShareNetwork },
  { id: "context" as const, label: "맥락 조회", icon: MagnifyingGlass },
  { id: "analysis" as const, label: "요구 분석", icon: Brain },
  { id: "evidence" as const, label: "근거 연결", icon: CheckCircle },
  { id: "quotation" as const, label: "견적 계산", icon: Calculator },
  { id: "review" as const, label: "사용자 검토", icon: Question },
];

const eventNode: Record<string, WorkflowNodeId> = {
  "run.started": "routing",
  "route.selected": "routing",
  "requirement.updated": "analysis",
  "clarification.requested": "review",
  "tool.started": "context",
  "tool.completed": "evidence",
  "evidence.added": "evidence",
  "quotation.draft.created": "quotation",
  "approval.requested": "review",
  "run.completed": "review",
  "run.failed": "review",
};

const statusCopy: Record<WorkflowSnapshot["status"], string> = {
  IDLE: "실행 대기",
  PREVIEW: "흐름 미리보기",
  QUEUED: "실행 준비",
  RUNNING: "실시간 처리 중",
  WAITING_FOR_USER: "사용자 응답 대기",
  COMPLETED: "실행 완료",
  FAILED: "실행 중단",
  CANCELLED: "사용자 중단",
};

export function snapshotFromEvents(
  events: WorkflowEvent[],
  status: AgentRunStatus | "PREVIEW" | "IDLE",
): WorkflowSnapshot {
  if (events.length === 0) {
    return {
      activeNode: status === "IDLE" ? "intake" : "routing",
      completedNodes: status === "IDLE" ? [] : ["intake"],
      status,
      eventLabel: status === "IDLE" ? "실행을 기다리고 있습니다" : "실행 경로를 준비하고 있습니다",
      eventCount: 0,
    };
  }
  const last = events.at(-1)!;
  const activeNode = eventNode[last.type] ?? "analysis";
  const activeIndex = nodes.findIndex((node) => node.id === activeNode);
  return {
    activeNode,
    completedNodes: nodes.slice(0, Math.max(activeIndex, 0)).map((node) => node.id),
    failedNode: last.type === "run.failed" || status === "FAILED" ? activeNode : undefined,
    status,
    eventLabel: publicEventLabel(last.type),
    eventCount: events.length,
  };
}

function publicEventLabel(type: string): string {
  return (
    {
      "run.started": "실행을 시작했습니다",
      "route.selected": "요청에 맞는 실행 경로와 모델을 선택했습니다",
      "requirement.updated": "요구사항 초안을 갱신했습니다",
      "clarification.requested": "사용자 확인을 기다리고 있습니다",
      "tool.started": "필요한 업무 정보를 조회하고 있습니다",
      "tool.completed": "업무 정보 조회를 완료했습니다",
      "evidence.added": "검토 가능한 근거를 연결했습니다",
      "quotation.draft.created": "견적 초안을 계산했습니다",
      "approval.requested": "최종 검토를 기다리고 있습니다",
      "run.completed": "분석을 완료했습니다",
      "run.failed": "실행을 안전하게 중단했습니다",
    }[type] ?? "분석을 진행하고 있습니다"
  );
}

export function LiveWorkflow({ snapshot, preview = false }: { snapshot: WorkflowSnapshot; preview?: boolean }) {
  const activeIndex = nodes.findIndex((node) => node.id === snapshot.activeNode);
  const isMoving = snapshot.status === "PREVIEW" || snapshot.status === "QUEUED" || snapshot.status === "RUNNING";
  const isComplete = snapshot.status === "COMPLETED";
  const progress = isComplete ? 100 : Math.round((snapshot.completedNodes.length / nodes.length) * 100);
  const trackProgress = isComplete ? 100 : Math.max(0, activeIndex) / (nodes.length - 1) * 100;

  return (
    <section className={`live-graph status-${snapshot.status.toLowerCase()}`} aria-label={preview ? "제품 흐름 미리보기" : "분석 진행 상황"}>
      <div className="live-graph-head">
        <div>
          <span className={`live-dot ${isMoving ? "moving" : ""}`} aria-hidden="true" />
          <strong>{preview ? "제품 흐름 미리보기" : "분석 진행 상황"}</strong>
        </div>
        <span>{statusCopy[snapshot.status]}</span>
      </div>
      <div className="workflow-progress" role="progressbar" aria-label="분석 진행률" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
        <span style={{ width: `${progress}%` }} />
      </div>
      <div className="workflow-rail">
        <div className={`workflow-track ${isMoving ? "moving" : ""}`} aria-hidden="true">
          <span className="workflow-track-progress" style={{ width: `${trackProgress}%` }} />
        </div>
        {nodes.map((node) => {
          const Icon = node.icon;
          const state = isComplete
            ? "completed"
            : snapshot.failedNode === node.id
            ? "failed"
            : snapshot.activeNode === node.id
              ? "active"
              : snapshot.completedNodes.includes(node.id)
                ? "completed"
                : "pending";
          const stateLabel = state === "completed"
            ? "완료"
            : state === "failed"
              ? "중단"
              : state === "active"
                ? snapshot.status === "WAITING_FOR_USER" ? "확인 필요" : "처리 중"
                : "대기";
          return (
            <div className="workflow-node-wrap" key={node.id}>
              <div className={`workflow-node ${state}`} aria-current={state === "active" ? "step" : undefined}>
                <span className="workflow-node-icon">
                  <Icon size={21} weight={state === "active" ? "duotone" : "regular"} />
                </span>
                <span className="workflow-node-label">{node.label}</span>
                <small>{stateLabel}</small>
              </div>
            </div>
          );
        })}
      </div>
      <div className="live-event" aria-live="polite">
        <div><p>{snapshot.eventLabel}</p><small>{nodes[Math.max(activeIndex, 0)].label} · {snapshot.eventCount.toLocaleString("ko-KR")}개 이벤트</small></div>
      </div>
    </section>
  );
}
