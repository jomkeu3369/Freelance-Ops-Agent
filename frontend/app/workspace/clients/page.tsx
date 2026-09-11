"use client";

import { ClientsPanel } from "../../../features/workspace/clients/clients-panel";
import { useWorkspace } from "../../../features/workspace/workspace-context";

export default function ClientsPanelPage() {
  const { clients } = useWorkspace();
  return <ClientsPanel {...clients} />;
}
