import { redirect } from "next/navigation";
import { buildWorkspacePath } from "../../../lib/workspace-navigation.mjs";

interface ProjectPageProps {
  params: Promise<{ projectId: string }>;
}

export default async function ProjectPage({ params }: ProjectPageProps) {
  const { projectId } = await params;
  redirect(buildWorkspacePath({ view: "project", projectId, step: "intake" }));
}
