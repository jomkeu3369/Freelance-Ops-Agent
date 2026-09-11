import { AuthSession, Project, Client, ProjectInput, updateProjectDetails } from "../../../../app/lib/api";
import { useRef, useState, FormEvent } from "react";
import { useDialogFocusTrap } from "../../shared/use-dialog-focus-trap";
import { Warning, CircleNotch, CheckCircle } from "@phosphor-icons/react";

interface ProjectEditDialogProps {
  session: AuthSession;
  project: Project;
  clients: Client[];
  onClose: () => void;
  onUpdated: (project: Project) => void;
}

export function ProjectEditDialog({ session, project, clients, onClose, onUpdated }: ProjectEditDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useDialogFocusTrap(dialogRef, onClose, busy);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    const budgetMin = data.get("budgetMin") ? Number(data.get("budgetMin")) : null;
    const budgetMax = data.get("budgetMax") ? Number(data.get("budgetMax")) : null;
    if (budgetMin != null && budgetMax != null && budgetMin > budgetMax) {
      setError("최소 예산은 최대 예산보다 클 수 없습니다.");
      return;
    }
    const input: ProjectInput = {
      clientId: String(data.get("clientId")) || null,
      title: String(data.get("title")).trim(),
      requirementText: String(data.get("requirementText")).trim(),
      currency: String(data.get("currency")),
      deadline: String(data.get("deadline")) || null,
      budgetMin,
      budgetMax
    };
    setBusy(true);
    setError(null);
    try {
      onUpdated(await updateProjectDetails(session, project, input));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "프로젝트 정보를 저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="project-dialog project-edit-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-edit-title"
      >
        <div>
          <span>프로젝트 정보</span>
          <button type="button" disabled={busy} onClick={onClose} aria-label="닫기">
            ×
          </button>
        </div>
        <h2 id="project-edit-title">문의 조건을 최신 상태로 맞추세요.</h2>
        <p>
          변경한 내용은 다음 AI 분석과 새 견적부터 반영됩니다. 이미 고객에게 보낸 견적은 그대로 유지됩니다.
        </p>
        {error && (
          <div className="inline-error" role="alert">
            <Warning size={18} />
            {error}
          </div>
        )}
        <form aria-busy={busy} onSubmit={submit}>
          <fieldset className="dialog-fields" disabled={busy}>
            <div className="form-row">
              <label>
                고객 연결
                <select name="clientId" defaultValue={project.clientId ?? ""}>
                  <option value="">연결하지 않음</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                      {client.companyName ? ` · ${client.companyName}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                통화
                <select name="currency" defaultValue={project.currency}>
                  <option value="KRW">KRW</option>
                  <option value="USD">USD</option>
                  <option value="JPY">JPY</option>
                </select>
              </label>
            </div>
            <label>
              프로젝트 이름
              <input data-autofocus name="title" required maxLength={200} defaultValue={project.title} />
            </label>
            <label>
              고객 문의 원문
              <textarea
                name="requirementText"
                required
                maxLength={50000}
                rows={8}
                defaultValue={project.requirementText}
              />
            </label>
            <div className="form-row">
              <label>
                희망 완료일
                <input name="deadline" type="date" defaultValue={project.deadline ?? ""} />
              </label>
              <label>
                최소 예산
                <input
                  name="budgetMin"
                  type="number"
                  min="0"
                  step="10000"
                  defaultValue={project.budgetMin ?? ""}
                />
              </label>
              <label>
                최대 예산
                <input
                  name="budgetMax"
                  type="number"
                  min="0"
                  step="10000"
                  defaultValue={project.budgetMax ?? ""}
                />
              </label>
            </div>
            <div className="dialog-actions">
              <button type="button" className="quiet-button" onClick={onClose}>
                취소
              </button>
              <button type="submit" className="primary-button">
                {busy ? <CircleNotch className="spin" /> : <CheckCircle size={18} />} 변경 저장
              </button>
            </div>
          </fieldset>
        </form>
      </section>
    </div>
  );
}
