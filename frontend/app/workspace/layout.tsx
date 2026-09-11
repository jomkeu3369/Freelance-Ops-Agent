import { ReactNode } from "react";
import { WorkspaceShell } from "../../features/workspace/workspace-shell";

interface WorkspaceLayoutProps {
  children: ReactNode;
}

export default function WorkspaceLayout({ children }: WorkspaceLayoutProps) {
  return <WorkspaceShell>{children}</WorkspaceShell>;
}
