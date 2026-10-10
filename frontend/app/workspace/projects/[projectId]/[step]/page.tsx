"use client";

import { ProjectWorkbench } from "../../../../../features/workspace/project/project-workbench";
import { EmptyWorkspace } from "../../../../../features/workspace/project/empty-workspace";
import { currentSessionGeneration } from "../../../../../app/lib/api";
import { useWorkspace } from "../../../../../features/workspace/workspace-context";

export default function ProjectStepPage() {
  const { project, empty } = useWorkspace();
  if (!project) return <EmptyWorkspace {...empty} />;
  return <ProjectWorkbench key={`${project.session.userId}:${project.session.workspaceId}:${currentSessionGeneration()}:${project.project.id}`} {...project} />;
}
