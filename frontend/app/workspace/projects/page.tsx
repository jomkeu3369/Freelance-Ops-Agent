"use client";

import { useEffect } from "react";
import { PipelineBoard } from "../../../features/workspace/projects/pipeline-board";
import { useWorkspace } from "../../../features/workspace/workspace-context";

export default function PipelineBoardPage() {
  const { projects, restorePipelinePosition } = useWorkspace();
  useEffect(() => {
    const frame = requestAnimationFrame(restorePipelinePosition);
    return () => cancelAnimationFrame(frame);
  }, [restorePipelinePosition]);
  return <PipelineBoard {...projects} />;
}
