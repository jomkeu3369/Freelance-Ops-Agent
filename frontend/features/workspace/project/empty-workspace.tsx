import { useT } from "../../../app/lib/ui-language";
import { FolderOpen, Plus } from "@phosphor-icons/react";

interface EmptyWorkspaceProps {
  canCreate: boolean;
  onCreate: () => void;
}

export function EmptyWorkspace({ canCreate, onCreate }: EmptyWorkspaceProps) {
  const t = useT();
  return (
    <div className="workspace-empty">
      <FolderOpen size={42} weight="duotone" />
      <h1>{canCreate ? t("첫 고객 문의를 등록하세요.") : t("표시할 프로젝트가 없습니다.")}</h1>
      <p>
        {canCreate
          ? t("프로젝트 이름과 고객이 보낸 메시지만 있으면 시작할 수 있습니다. 고객 연결과 예산은 나중에 추가하세요.")
          : t("현재 계정에서는 새 프로젝트를 만들 수 없습니다.")}
      </p>
      {canCreate && (
        <button type="button" className="primary-button" onClick={onCreate}>
          <Plus size={18} /> {t("첫 고객 문의 등록")}</button>
      )}
      <ol className="first-inquiry-steps" aria-label={t("문의 이후의 진행 순서")}>
        <li><span>01</span><strong>{t("문의 보관")}</strong><p>{t("고객이 보낸 내용을 그대로 남깁니다.")}</p></li>
        <li><span>02</span><strong>{t("요구사항 확인")}</strong><p>{t("필요한 정보와 확인할 질문을 정리합니다.")}</p></li>
        <li><span>03</span><strong>{t("견적 검토")}</strong><p>{t("범위와 금액을 검토하고 직접 확정합니다.")}</p></li>
      </ol>
    </div>
  );
}
