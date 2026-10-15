import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import type { Project, ProjectStatus } from "../../../app/lib/api";
import { pipelineColumns } from "../shared/constants";

const projectDragType = "application/x-freelance-ops-project";

/** 데스크톱은 기본 드래그를 사용하고 키보드·터치는 기존 단계 선택기를 사용한다. */
export function usePipelineDrag({ projects, enabled, onMove }: { projects: Project[]; enabled: boolean; onMove: (project: Project, status: ProjectStatus) => void; }) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [targetKey, setTargetKey] = useState<string | null>(null);
  const drag = useRef<{ id: string; status: string } | null>(null);
  const preview = useRef<HTMLElement | null>(null);
  const suppressClickUntil = useRef(0);

  const cancel = useCallback(() => {
    if (drag.current) suppressClickUntil.current = Date.now() + 350;
    drag.current = null;
    preview.current?.remove();
    preview.current = null;
    setDraggingId(null);
    setTargetKey(null);
  }, []);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel();
    };
    window.addEventListener("keydown", escape, true);
    window.addEventListener("dragend", cancel);
    window.addEventListener("drop", cancel);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("keydown", escape, true);
      window.removeEventListener("dragend", cancel);
      window.removeEventListener("drop", cancel);
      window.removeEventListener("blur", cancel);
      preview.current?.remove();
    };
  }, [cancel]);

  useEffect(() => {
    const current = drag.current;
    if (
      current &&
      (!enabled || !projects.some((project) => project.id === current.id && project.status === current.status))
    ) {
      // 권한·원본·화면이 사라지면 브라우저의 드래그 상태도 정리한다.
      cancel();
    }
  }, [enabled, projects, cancel]);

  const start = (event: DragEvent<HTMLElement>, project: Project) => {
    if (
      !enabled ||
      drag.current ||
      (event.target instanceof Element && event.target.closest("select, option, label, input, a"))
    ) {
      event.preventDefault();
      return;
    }
    drag.current = { id: project.id, status: project.status };
    suppressClickUntil.current = Number.POSITIVE_INFINITY;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(projectDragType, project.id);
    // 원본 카드가 흐려져도 이동 미리보기는 불투명하도록 별도 이미지로 표시한다.
    const card = event.currentTarget;
    const bounds = card.getBoundingClientRect();
    const ghost = card.cloneNode(true) as HTMLElement;
    ghost.removeAttribute("data-project-id");
    ghost.className = "pipeline-drag-preview";
    ghost.setAttribute("aria-hidden", "true");
    ghost.inert = true;
    ghost.style.width = `${bounds.width}px`;
    card.parentElement?.appendChild(ghost);
    preview.current = ghost;
    event.dataTransfer.setDragImage(
      ghost,
      Math.min(event.clientX - bounds.left, bounds.width),
      Math.min(event.clientY - bounds.top, bounds.height)
    );
    setDraggingId(project.id);
    setTargetKey(null);
  };

  const validProject = () => {
    const current = drag.current;
    return enabled && current
      ? projects.find((project) => project.id === current.id && project.status === current.status)
      : undefined;
  };

  const over = (event: DragEvent<HTMLElement>, column: (typeof pipelineColumns)[number]) => {
    const project = validProject();
    if (!project) return;
    event.preventDefault();
    const sameColumn = column.statuses.some((status) => status === project.status);
    event.dataTransfer.dropEffect = sameColumn ? "none" : "move";
    setTargetKey(sameColumn ? null : column.key);
  };

  const drop = (event: DragEvent<HTMLElement>, column: (typeof pipelineColumns)[number]) => {
    const project = validProject();
    event.preventDefault();
    const matches = project && event.dataTransfer.getData(projectDragType) === project.id;
    cancel(); // 중복 드롭이나 상태 렌더링 전에 드래그를 동기적으로 소비한다.
    if (matches && !column.statuses.some((status) => status === project.status)) onMove(project, column.moveTo);
  };

  return {
    draggingId,
    targetKey,
    start,
    over,
    drop,
    cancel,
    leave(event: DragEvent<HTMLElement>) {
      if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget))
        setTargetKey(null);
    },
    canOpen() {
      return !drag.current && Date.now() >= suppressClickUntil.current;
    }
  };
}
