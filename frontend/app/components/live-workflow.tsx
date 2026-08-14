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
      "requirement.updated": "요구사항 초안을 갱신했습니다",
      "clarification.requested": "사용자 확인을 기다리고 있습니다",
      "tool.started": "필요한 업무 정보를 조회하고 있습니다",
      "tool.completed": "업무 정보 조회를 완료했습니다",
      "evidence.added": "검토 가능한 근거를 연결했습니다",
      "quotation.draft.created": "견적 초안을 계산했습니다",
      "approval.requested": "최종 검토를 기다리고 있습니다",
      "run.completed": "워크플로우를 완료했습니다",
      "run.failed": "실행을 안전하게 중단했습니다",
    }[type] ?? "워크플로우가 진행 중입니다"
  );
}

export function LiveWorkflow({ snapshot, preview = false }: { snapshot: WorkflowSnapshot; preview?: boolean }) {
  return (
    <section className="live-graph" aria-label={preview ? "제품 흐름 미리보기" : "실시간 Agent 워크플로우"}>
      <div className="live-graph-head">
        <div>
          <span className={`live-dot ${snapshot.status === "FAILED" ? "failed" : ""}`} />
          <strong>{preview ? "제품 흐름 미리보기" : "실시간 실행 그래프"}</strong>
        </div>
        <span>{preview ? "DEMO" : `${snapshot.eventCount} EVENTS`}</span>
      </div>
      <div className="workflow-rail">
        {nodes.map((node, index) => {
          const Icon = node.icon;
          const state = snapshot.failedNode === node.id
            ? "failed"
            : snapshot.activeNode === node.id
              ? "active"
              : snapshot.completedNodes.includes(node.id)
                ? "completed"
                : "pending";
          return (
            <div className="workflow-node-wrap" key={node.id}>
              <div className={`workflow-node ${state}`} aria-current={state === "active" ? "step" : undefined}>
                <span className="node-orbit" aria-hidden="true" />
                <Icon size={21} weight={state === "active" ? "duotone" : "regular"} />
                <span>{node.label}</span>
              </div>
              {index < nodes.length - 1 && (
                <div className={`workflow-link ${snapshot.completedNodes.includes(node.id) ? "completed" : ""}`}>
                  <span aria-hidden="true" />
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="live-event" aria-live="polite">
        <span className="signal-bars" aria-hidden="true"><i /><i /><i /><i /></span>
        <p>{snapshot.eventLabel}</p>
      </div>
    </section>
  );
}
