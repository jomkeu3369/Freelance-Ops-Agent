import { redirect } from "next/navigation";
import { buildWorkspacePath, parseWorkspaceLocation } from "../lib/workspace-navigation.mjs";

interface WorkspacePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// 기존에 공유한 ?view=project&project=...&step=... 주소도 계속 열립니다.
export default async function WorkspacePage({ searchParams }: WorkspacePageProps) {
  const values = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === "string") query.set(key, value);
    else if (value?.[0]) query.set(key, value[0]);
  }
  redirect(buildWorkspacePath(parseWorkspaceLocation(query.toString())));
}
