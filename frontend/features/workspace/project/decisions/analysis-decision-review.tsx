import { useT } from "@/app/lib/ui-language";
import type { AgentRunView, AuthSession, Project } from "@/app/lib/api";
import { ArrowRight, CheckCircle, CircleNotch, ListChecks, Warning } from "@phosphor-icons/react";
import { opinionLabel } from "./analysis-decision-state";
import { useAnalysisDecisionReview } from "./use-analysis-decision-review";
import "./analysis-decisions.css";

interface Props {
  session: AuthSession; project: Project; permissions: Set<string>; run: AgentRunView | null;
  onReturnToAnalysis: () => void; onContinue: (decisionId: string) => void;
}

export function AnalysisDecisionReview({ session, project, permissions, run, onReturnToAnalysis, onContinue }: Props) {
  const t = useT();
  const model = useAnalysisDecisionReview(session, project, permissions, run);
  const decision = model.decision;
  const source = model.source;

  if (!model.canRead) return <section className="workspace-empty"><ListChecks size={32} /><h2>{t("의견 정리를 볼 권한이 없습니다.")}</h2></section>;
  return <section className="analysis-decisions" aria-label={t("의견 정리와 확정")}>
    <header className="decision-heading"><div><span>{t("선택한 관점, 내가 검토한 결과")}</span><h2>{t("의견을 모으고, 결과를 확정합니다.")}</h2>
      <p>{t("하나의 프로젝트 전체 분석에서 나온 3개 계획 관점입니다. 선택한 의견을 원본과 함께 정리하며, 추가 AI 재분석은 실행하지 않습니다.")}</p></div>
      <button className="secondary-button" type="button" onClick={onReturnToAnalysis}>{t("프로젝트 전체 분석으로")}<ArrowRight size={17} /></button></header>

    {model.sourceLoading && <p role="status"><CircleNotch className="spin" /> {t("분석 출처 확인 중…")}</p>}
    {model.sourceError && <p className="form-error" role="alert">{t(model.sourceError)}</p>}
    {!model.sourceLoading && model.canReadSource && !model.opinions.length && <div className="decision-notice"><Warning size={20} /><p>{source?.sourceProjectVersion !== undefined && source?.sourceProjectVersion !== project.version
      ? t("분석 이후 프로젝트가 변경되었습니다. 최신 문의 원문으로 프로젝트 전체 분석을 다시 실행해 주세요.")
      : source && source.view.status !== "COMPLETED" ? t("프로젝트 전체 분석이 아직 완료되지 않았습니다. 부분·실패·취소 결과는 확정할 수 없습니다.")
      : source && !source.view.result ? t("분석 출처 응답을 확인하지 못했습니다. 잘못된 결과는 선택하거나 확정하지 않습니다.")
      : source && !source.sourceCurrent ? t("분석 이후 문의 원문·요구사항 확정·추가 답변이 달라졌습니다. 최신 내용으로 프로젝트 전체 분석을 다시 실행해 주세요.")
        : t("완료된 프로젝트 전체 분석과 3개 계획 의견이 필요합니다. AI 분석에서 ‘프로젝트 전체 분석 시작’을 눌러 주세요.")}</p></div>}

    {model.opinions.length > 0 && <section className="decision-opinion-selection" aria-label={t("계획 의견 선택")}>
      <p className="decision-provenance">{t("분석 출처")}: {source!.runId} · {t("원문 버전")}: {source!.sourceProjectVersion}</p>
      <div className="decision-opinion-grid">{model.opinions.map(opinion => {
        const perspective = opinion.draft.petPerspective!;
        const pet = source?.view.metadata?.petProfiles?.find(value => value.slot === opinion.scenario);
        return <article className="decision-opinion" key={opinion.id}>
          <label className="decision-opinion-title"><input type="checkbox" checked={model.selectedIds.includes(opinion.id)} disabled={!model.canWrite || model.busy}
            onChange={() => model.toggle(opinion.id)} aria-label={t("{v0} 선택", { v0: t(opinionLabel(opinion.scenario)) })} />
            <span><strong>{t(opinionLabel(opinion.scenario))}</strong><small>{pet ? `${pet.name} · ` : ""}{t("같은 분석의 계획 관점")}</small></span></label>
          <h3>{perspective.proposal}</h3><p>{perspective.rationale}</p><div className="decision-tradeoff"><strong>{t("함께 생각할 점")}</strong><p>{perspective.tradeoff}</p></div>
          <details><summary>{t("작업과 근거 {count}개", { count: opinion.draft.items.length })}</summary><ul>{opinion.draft.items.map((item, index) => <li key={index}>
            <strong>{item.title}</strong><span>{item.quantity} {item.unit}</span><p>{item.description}</p><small>{item.basis.type === "ASSUMPTION" ? t("미확정 가정") : t("근거")} · {item.basis.content}</small>
            {item.basis.sourceReference && <p className="decision-source-reference">{t("근거 참조")}: {item.basis.sourceReference}</p>}</li>)}</ul></details>
        </article>;
      })}</div>
      <div className="decision-selection-actions"><p>{t("{count}개 의견 선택", { count: model.selected.length })} · {t("중복과 상충하는 내용은 자동으로 삭제하거나 합산하지 않습니다.")}</p>
        <button type="button" className="primary-button" disabled={!model.canWrite || !model.selected.length || model.busy || model.sourceLoading} onClick={() => void model.create()}>
          {model.busy ? t("처리 중…") : t("선택 의견으로 정리 초안 만들기")}</button></div>
    </section>}

    {model.loading && <p role="status">{t("저장된 정리 버전 확인 중…")}</p>}
    {model.error && <p className="form-error" role="alert">{t(model.error)}</p>}
    {model.notice && <p className="form-notice" role="status">{t(model.notice)}</p>}
    {model.selectionChanged && <div className="decision-notice" role="alert"><p>{t("의견 선택이 저장된 초안과 다릅니다. 바뀐 선택으로 새 정리 초안을 만든 뒤 검토해 주세요. 현재 본문과 출처는 아직 바뀌지 않았습니다.")}</p>
      {source?.runId === decision?.sourceRunId && <button type="button" className="quiet-button" onClick={model.restoreSelection}>{t("저장된 의견 선택으로 돌아가기")}</button>}</div>}
    {model.storageUnavailable && <p role="status">{t("이 브라우저의 임시 저장을 사용할 수 없습니다. 수정 내용은 서버에 새 버전으로 저장하기 전까지 현재 화면에만 남습니다.")}</p>}

    {decision && <section className="decision-editor" aria-label={t("의견 종합 초안 검토")}>
      <header><div><span className={`decision-status ${decision.status.toLowerCase()}`}>{decision.status === "CONFIRMED" ? <CheckCircle size={16} /> : <ListChecks size={16} />}{decision.status === "CONFIRMED" ? t("사용자 확정본") : t("검토용 초안")}</span>
        <h3>{t("의견 정리")} v{decision.versionNumber}</h3><p>{decision.bodyOrigin === "USER_EDITED" ? t("사용자 수정 버전 · 원본 의견과 최초 정리 내용은 보존됩니다.") : t("선택 의견을 결정적으로 모은 정리 초안 · AI 재분석 아님")}</p></div>
        <small>{t("원문 버전")}: {decision.sourceProjectVersion} · {t("선택 의견")}: {decision.selectedOpinionIds.length}</small></header>
      {(model.stale || !model.latestRevision) && <p className="decision-notice" role="alert">{model.stale ? t("프로젝트가 변경되어 이 정리 버전을 새로 확정할 수 없습니다. 과거 내용은 그대로 보관됩니다.") : t("새 정리 버전이 있습니다. 최신 버전을 불러온 뒤 검토해 주세요.")}</p>}
      {decision.reviewWarnings.length > 0 && <aside className="decision-warnings"><h4>{t("확정 전 확인할 점")}</h4><ul>{decision.reviewWarnings.map((warning, index) => <li key={index}>{t(warning)}</li>)}</ul></aside>}
      <label className="decision-body-label">{t("검토한 결과 내용")}<textarea rows={18} maxLength={100000} value={model.bodyText} disabled={model.busy || !model.canWrite || model.stale || !model.latestRevision}
        onChange={event => model.edit(event.target.value)} /></label>
      <p>{t("내용 수정은 새 버전으로 저장합니다. 이미 확정한 본문은 변경되지 않으며, 새 수정 버전은 다시 확정해야 합니다.")}</p>
      <details className="workspace-disclosure"><summary>{t("원본 의견·최초 정리·출처 확인")}</summary>
        <p>{t("분석 실행")}: {decision.sourceRunId}</p><p>{t("선택 의견 식별자")}: {decision.selectedOpinionIds.join(", ")}</p>
        <p>{t("확정 전 내용 식별자")}: {decision.contentHash}</p>
        {decision.sourceOpinions.map(opinion => <article key={opinion.opinionId}><h4>{t(opinionLabel(opinion.scenario))}</h4><p>{opinion.draft.petPerspective?.proposal}</p><p>{opinion.draft.petPerspective?.rationale}</p><p>{opinion.draft.petPerspective?.tradeoff}</p></article>)}
        <h4>{t("최초 정리 초안")}</h4><pre>{decision.originalBodyText}</pre>
        <h4>{t("원문과 사용자 답변")}</h4>{decision.sourceMessages.map(source => <article key={source.id}><strong>{source.kind}</strong>{source.prompt && <p>{source.prompt}</p>}<pre>{source.content}</pre></article>)}
      </details>
      <div className="decision-editor-actions"><button type="button" className="secondary-button" disabled={!model.canWrite || !model.dirty || model.stale || !model.latestRevision || model.busy || !model.bodyText.trim()} onClick={() => void model.saveRevision()}>{t("수정 내용 새 버전 저장")}</button></div>
      {decision.status === "DRAFT" && <div className="decision-confirmation"><label><input type="checkbox" checked={model.acknowledged} disabled={model.busy || model.dirty || model.selectionChanged || model.stale || !model.latestRevision || !model.canWrite}
        onChange={event => model.setAcknowledged(event.target.checked)} />{t("선택 의견, 범위 차이, 중복, 근거와 미확정 가정·열린 질문을 검토했습니다. 이 내용을 결과 확정본으로 저장합니다.")}</label>
        <button type="button" className="primary-button" disabled={!model.acknowledged || !model.canWrite || model.busy || model.dirty || model.selectionChanged || model.stale || !model.latestRevision} onClick={() => void model.confirm()}>{t("검토한 결과 확정")}</button>
        {model.dirty && <small>{t("수정 내용을 새 버전으로 저장한 뒤 확정해 주세요.")}</small>}</div>}
      {decision.status === "CONFIRMED" && <div className="decision-confirmed-actions"><p>{t("확정 시각")}: {decision.confirmedAt ? new Date(decision.confirmedAt).toLocaleString() : ""}</p>
        <button type="button" className="primary-button" disabled={model.dirty || model.selectionChanged || model.busy || model.stale} onClick={() => onContinue(decision.id)}>{t("확정 결과로 명세 만들기")}<ArrowRight size={17} /></button></div>}
    </section>}
    {model.history.length > 0 && <details className="workspace-disclosure"><summary>{t("저장된 정리 버전")}<small>{t("최근 {count}개", { count: model.history.length })}</small></summary><ul className="decision-history">{model.history.map(value => <li key={value.id}>
      <span>v{value.versionNumber} · {value.status === "CONFIRMED" ? t("사용자 확정본") : t("검토용 초안")} · {new Date(value.createdAt).toLocaleString()}</span>
      <button type="button" className="quiet-button" disabled={model.busy || value.id === decision?.id} onClick={() => model.load(value)}>{t("불러오기")}</button></li>)}</ul></details>}
  </section>;
}
