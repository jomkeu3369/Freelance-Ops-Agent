"use client";

import { ComponentProps, createContext, useContext } from "react";
import { PipelineBoard } from "./projects/pipeline-board";
import { ClientsPanel } from "./clients/clients-panel";
import { KnowledgePanel } from "./knowledge/knowledge-panel";
import { SettingsPanel } from "./settings/settings-panel";
import { ProjectWorkbench } from "./project/project-workbench";
import { EmptyWorkspace } from "./project/empty-workspace";

// 공통 레이아웃이 관리하는 세션과 작업 상태를 각 페이지에 전달합니다.
export interface WorkspaceScreens {
  restorePipelinePosition: () => void;
  projects: ComponentProps<typeof PipelineBoard>;
  clients: ComponentProps<typeof ClientsPanel>;
  knowledge: ComponentProps<typeof KnowledgePanel>;
  settings: ComponentProps<typeof SettingsPanel>;
  project: ComponentProps<typeof ProjectWorkbench> | null;
  empty: ComponentProps<typeof EmptyWorkspace>;
}

export const WorkspaceContext = createContext<WorkspaceScreens | null>(null);

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("업무 페이지는 WorkspaceShell 내부에서 사용해야 합니다.");
  return context;
}
