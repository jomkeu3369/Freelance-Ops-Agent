"use client";

import { KnowledgePanel } from "../../../features/workspace/knowledge/knowledge-panel";
import { useWorkspace } from "../../../features/workspace/workspace-context";

export default function KnowledgePanelPage() {
  const { knowledge } = useWorkspace();
  return <KnowledgePanel {...knowledge} />;
}
