import { FolderOpen, Plus } from "@phosphor-icons/react";

interface EmptyWorkspaceProps {
  canCreate: boolean;
  onCreate: () => void;
}

export function EmptyWorkspace({ canCreate, onCreate }: EmptyWorkspaceProps) {
  return (
    <div className="workspace-empty">
      <FolderOpen size={42} weight="duotone" />
      <h1>{canCreate ? "첫 고객 문의를 등록하세요." : "표시할 프로젝트가 없습니다."}</h1>
      <p>
        {canCreate
          ? "프로젝트를 만들면 요구사항 정리와 AI 분석을 바로 시작할 수 있습니다."
          : "현재 계정에서는 새 프로젝트를 만들 수 없습니다."}
      </p>
      {canCreate && (
        <button type="button" className="primary-button" onClick={onCreate}>
          <Plus size={18} /> 새 프로젝트
        </button>
      )}
    </div>
  );
}
