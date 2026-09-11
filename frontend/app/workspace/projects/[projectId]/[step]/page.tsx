"use client";

import { ProjectWorkbench } from "../../../../../features/workspace/project/project-workbench";
import { EmptyWorkspace } from "../../../../../features/workspace/project/empty-workspace";
import { useWorkspace } from "../../../../../features/workspace/workspace-context";

export default function ProjectStepPage() {
  const { project, empty } = useWorkspace();
  if (!project) return <EmptyWorkspace {...empty} />;
  return <ProjectWorkbench {...project} />;
}
