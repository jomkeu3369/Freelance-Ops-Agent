import { ReactNode } from "react";
import { WorkspaceShell } from "../../features/workspace/workspace-shell";
import "../../features/workspace/pets/pets.css";

interface WorkspaceLayoutProps {
  children: ReactNode;
}

export default function WorkspaceLayout({ children }: WorkspaceLayoutProps) {
  return <WorkspaceShell>{children}</WorkspaceShell>;
}
