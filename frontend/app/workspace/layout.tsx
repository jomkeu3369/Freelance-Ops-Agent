import { privateMetadata } from "../lib/site-metadata";

export const metadata = privateMetadata;

import { LocaleProvider } from "../lib/ui-language";
import { ReactNode } from "react";
import { WorkspaceShell } from "../../features/workspace/workspace-shell";
import "../../features/workspace/pets/pets.css";
import "../../features/workspace/pets/pet-library.css";
import "../../features/workspace/auth/auth.css";
import "../../features/workspace/shared/disclosure.css";

interface WorkspaceLayoutProps {
  children: ReactNode;
}

export default function WorkspaceLayout({ children }: WorkspaceLayoutProps) {
  return (
    <LocaleProvider>
      <WorkspaceShell>{children}</WorkspaceShell>
    </LocaleProvider>
  );
}
