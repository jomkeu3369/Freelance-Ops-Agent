import type { FormEvent } from "react";
import {
  AuthSession,
  Project,
  RequirementVersion,
  KnowledgeDocument,
  RequirementFeature,
  listRequirements,
  listDocuments,
  createDocument,
  createRequirementVersion
} from "../../../../app/lib/api";
import { useState, useRef, useEffect, useMemo } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { FileText, CircleNotch, Plus, Warning, CheckCircle, Trash, ArrowRight } from "@phosphor-icons/react";
import { formatMoney } from "../../shared/formatters";
import { prepareDocumentUpload } from "../../shared/documents";

gsap.registerPlugin(useGSAP);

export function compactDiffExcerpt(value: string, limit = 520): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= limit) return normalized;
  const half = Math.floor((limit - 3) / 2);
  return `${normalized.slice(0, half)} … ${normalized.slice(-half)}`;
}

export function requirementTextDelta(previous: string, current: string) {
  if (previous === current) return { changed: false, removed: "", added: "" };
  let prefix = 0;
  const maxPrefix = Math.min(previous.length, current.length);
  while (prefix < maxPrefix && previous[prefix] === current[prefix]) prefix += 1;

  let suffix = 0;
  const maxSuffix = Math.min(previous.length - prefix, current.length - prefix);
  while (
    suffix < maxSuffix &&
    previous[previous.length - 1 - suffix] === current[current.length - 1 - suffix]
  )
    suffix += 1;

  const previousEnd = suffix ? previous.length - suffix : previous.length;
  const currentEnd = suffix ? current.length - suffix : current.length;
  return {
    changed: true,
    removed: compactDiffExcerpt(previous.slice(prefix, previousEnd)),
    added: compactDiffExcerpt(current.slice(prefix, currentEnd))
  };
}

interface IntakeReviewProps {
  session: AuthSession;
  project: Project;
  permissions: Set<string>;
  onContinue: () => void;
}

export function IntakeReview({ session, project, permissions, onContinue }: IntakeReviewProps) {
  const canWriteProject = permissions.has("project.write");
  const canReadDocuments = permissions.has("document.read");
  const canWriteDocuments = permissions.has("document.write");
  const [versions, setVersions] = useState<RequirementVersion[]>([]);
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [features, setFeatures] = useState<RequirementFeature[]>([
    { title: "", description: "", priority: "MUST", acceptanceCriteria: "" }
  ]);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const diffRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      listRequirements(session, project.id),
      canReadDocuments ? listDocuments(session) : Promise.resolve([])
    ])
      .then(([result, nextDocuments]) => {
        if (!cancelled) {
          setVersions(result);
          setDocuments(nextDocuments);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "요구사항을 불러오지 못했습니다.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canReadDocuments, project.id, session]);

  const latest = versions[0] ?? null;
  const structuredOutdated = Boolean(latest && latest.sourceText.trim() !== project.requirementText.trim());
  const textDelta = useMemo(
    () => (latest ? requirementTextDelta(latest.sourceText.trim(), project.requirementText.trim()) : null),
    [latest, project.requirementText]
  );

  useGSAP(
    () => {
      if (
        !latest ||
        editing ||
        !diffRef.current ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      )
        return;
      gsap.fromTo(
        ".requirement-diff-summary > article",
        { y: 18, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.48, stagger: 0.07, ease: "power3.out" }
      );
      gsap.fromTo(
        ".requirement-diff-map > article",
        { y: 24, scale: 0.985, opacity: 0 },
        { y: 0, scale: 1, opacity: 1, duration: 0.58, stagger: 0.1, ease: "power3.out" }
      );
    },
    { scope: diffRef, dependencies: [editing, latest?.id, structuredOutdated], revertOnUpdate: true }
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const data = new FormData(event.currentTarget);
    try {
      const version = await createRequirementVersion(session, project.id, {
        sourceText: project.requirementText,
        features,
        assumptions: String(data.get("assumptions"))
          .split("\n")
          .map((item) => item.trim())
          .filter(Boolean),
        questions: String(data.get("questions"))
          .split("\n")
          .map((item) => item.trim())
          .filter(Boolean)
      });
      setVersions((current) => [version, ...current]);
      setEditing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "요구사항 버전을 저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="intake-review requirement-review">
      <div className="intake-document">
        <div>
          <FileText size={20} />
          <strong>고객 문의 원문</strong>
          <small>{project.requirementText.length.toLocaleString()}자</small>
        </div>
        <p>{project.requirementText}</p>
        <dl>
          <div>
            <dt>통화</dt>
            <dd>{project.currency}</dd>
          </div>
          <div>
            <dt>희망 완료일</dt>
            <dd>{project.deadline ?? "미정"}</dd>
          </div>
          <div>
            <dt>예산 범위</dt>
            <dd>
              {project.budgetMin == null && project.budgetMax == null
                ? "미정"
                : `${formatMoney(project.budgetMin ?? 0, project.currency)}–${formatMoney(project.budgetMax ?? 0, project.currency)}`}
            </dd>
          </div>
        </dl>
        <div className="document-upload-area">
          <div>
            <span>참고 문서</span>
            <small>TXT · Markdown · CSV · JSON, 최대 5MB</small>
          </div>
          {canWriteDocuments && (
            <label className="secondary-button">
              {uploading ? <CircleNotch className="spin" /> : <Plus size={17} />} 문서 추가
              <input
                type="file"
                accept=".txt,.md,.markdown,.csv,.json,text/plain,text/markdown,text/csv,application/json"
                disabled={uploading}
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file) return;
                  setUploading(true);
                  setError(null);
                  try {
                    const document = await createDocument(
                      session,
                      await prepareDocumentUpload(file, "EXTERNAL_SOURCE")
                    );
                    setDocuments((current) => [document, ...current]);
                  } catch (cause) {
                    setError(cause instanceof Error ? cause.message : "문서를 업로드하지 못했습니다.");
                  } finally {
                    setUploading(false);
                  }
                }}
              />
            </label>
          )}
          {documents.length > 0 && (
            <ul>
              {documents.slice(0, 3).map((document) => (
                <li key={document.id}>
                  <FileText size={15} />
                  <span>{document.title}</span>
                  <small>{document.status}</small>
                </li>
              ))}
            </ul>
          )}
          <p>
            업로드한 파일은 이 프로젝트의 참고 자료로 보관되며, AI 분석이 필요한 내용을 찾을 때 활용됩니다.
          </p>
        </div>
      </div>
      <div className="guided-copy">
        <span>사용자 입력 · 원문</span>
        <h2>
          문의 내용을
          <br />
          먼저 확인합니다.
        </h2>
        <p>
          고객 문의 원문과 아래 구조화 결과를 검토합니다. 저장된 버전은 사용자 확정 결과이며 AI 초안과
          구분됩니다.
        </p>
        <div className="requirement-version-state">
          <span>
            {loading
              ? "불러오는 중"
              : structuredOutdated
                ? "문의 변경됨 · 다시 확인 필요"
                : latest
                  ? `검토 완료 v${latest.versionNumber}`
                  : "정리 전"}
          </span>
          <small>
            {latest ? new Date(latest.createdAt).toLocaleString("ko-KR") : "첫 요구사항을 정리해 주세요."}
          </small>
        </div>
      </div>
      <div className="structured-requirements">
        <header>
          <div>
            <span>구조화된 요구사항</span>
            <h3>{latest ? `검토 완료된 버전 ${latest.versionNumber}` : "아직 확정된 버전이 없습니다."}</h3>
          </div>
          {canWriteProject && (
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                if (editing) {
                  setEditing(false);
                  return;
                }
                setFeatures(
                  latest?.features.map((feature) => ({ ...feature })) ?? [
                    { title: "", description: "", priority: "MUST", acceptanceCriteria: "" }
                  ]
                );
                setEditing(true);
              }}
            >
              {editing ? "편집 닫기" : latest ? "새 버전 만들기" : "직접 정리하기"}
            </button>
          )}
        </header>
        {structuredOutdated && (
          <div className="inline-error requirement-stale" role="status">
            <Warning size={18} />
            고객 문의가 마지막 검토 이후 변경되었습니다. 요구사항을 다시 확인한 뒤 견적을 작성해 주세요.
          </div>
        )}
        {error && (
          <div className="inline-error" role="alert">
            <Warning size={18} />
            {error}
          </div>
        )}
        {latest && !editing ? (
          <>
            <section
              className={`requirement-diff${structuredOutdated ? " stale" : " synced"}`}
              ref={diffRef}
              aria-labelledby="requirement-diff-title"
            >
              <header>
                <div>
                  <span>원문과 구조화 결과 비교</span>
                  <h4 id="requirement-diff-title">확정된 정보와 다시 볼 차이</h4>
                </div>
                <strong>{structuredOutdated ? "재검토 필요" : "원문 동기화됨"}</strong>
              </header>
              <div className="requirement-diff-summary" aria-label="구조화 결과 요약">
                <article>
                  <span>작업 범위</span>
                  <strong>{latest.features.length}</strong>
                  <small>기능으로 구조화</small>
                </article>
                <article>
                  <span>확인된 가정</span>
                  <strong>{latest.assumptions.length}</strong>
                  <small>견적 전제에 반영</small>
                </article>
                <article>
                  <span>열린 질문</span>
                  <strong>{latest.questions.length}</strong>
                  <small>추가 확인 필요</small>
                </article>
              </div>
              <div className="requirement-diff-map">
                <article>
                  <header>
                    <span>현재 고객 원문</span>
                    <strong>{project.requirementText.length.toLocaleString()}자</strong>
                  </header>
                  <p>{compactDiffExcerpt(project.requirementText, 700)}</p>
                  <dl>
                    <div>
                      <dt>희망 완료일</dt>
                      <dd>{project.deadline ?? "미정"}</dd>
                    </div>
                    <div>
                      <dt>예산 범위</dt>
                      <dd>
                        {project.budgetMin == null && project.budgetMax == null
                          ? "미정"
                          : `${formatMoney(project.budgetMin ?? 0, project.currency)}–${formatMoney(project.budgetMax ?? 0, project.currency)}`}
                      </dd>
                    </div>
                  </dl>
                </article>
                <article>
                  <header>
                    <span>사용자 확정 구조</span>
                    <strong>v{latest.versionNumber}</strong>
                  </header>
                  {latest.features.length ? (
                    <ol>
                      {latest.features.slice(0, 4).map((feature, index) => (
                        <li key={`${feature.title}-${index}`}>
                          <span>{feature.priority}</span>
                          <strong>{feature.title}</strong>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p>확정된 기능이 없습니다.</p>
                  )}
                  {latest.features.length > 4 && <small>그 외 {latest.features.length - 4}개 기능</small>}
                </article>
              </div>
              {structuredOutdated && textDelta?.changed ? (
                <details className="requirement-source-delta" open>
                  <summary>마지막 확정 원문과 현재 원문의 변경 부분</summary>
                  <div>
                    <section>
                      <span>이전 원문에서 빠진 부분</span>
                      <del>{textDelta.removed || "삭제된 내용 없음"}</del>
                    </section>
                    <section>
                      <span>현재 원문에 추가된 부분</span>
                      <ins>{textDelta.added || "추가된 내용 없음"}</ins>
                    </section>
                  </div>
                </details>
              ) : (
                <p className="requirement-diff-synced">
                  <CheckCircle size={17} weight="fill" /> 현재 원문이 이 구조화 revision의 기준 원문과
                  일치합니다.
                </p>
              )}
              <p className="requirement-diff-note">
                이 비교는 저장된 원문과 사용자 확정 revision만 보여 줍니다. 자동 의미 추정은 검토 완료로
                표시하지 않습니다.
              </p>
            </section>
            <div className="feature-list">
              {latest.features.length === 0 ? (
                <p className="empty-copy">등록된 기능이 없습니다.</p>
              ) : (
                latest.features.map((feature, index) => (
                  <article key={`${feature.title}-${index}`}>
                    <span>{feature.priority}</span>
                    <div>
                      <h4>{feature.title}</h4>
                      <p>{feature.description}</p>
                      {feature.acceptanceCriteria && <small>완료 기준 · {feature.acceptanceCriteria}</small>}
                    </div>
                  </article>
                ))
              )}
            </div>
            <div className="requirement-notes">
              <section>
                <h4>확인된 가정</h4>
                {latest.assumptions.length ? (
                  <ul>
                    {latest.assumptions.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : (
                  <p>기록된 가정이 없습니다.</p>
                )}
              </section>
              <section>
                <h4>열린 질문</h4>
                {latest.questions.length ? (
                  <ul>
                    {latest.questions.map((item) => (
                      <li key={item.content}>
                        {item.content}
                        <small>{item.status}</small>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>열린 질문이 없습니다.</p>
                )}
              </section>
            </div>
          </>
        ) : editing ? (
          <form className="requirement-editor" onSubmit={handleSubmit}>
            <div className="editor-label">
              <span>사용자 확정 입력</span>
              <p>기능마다 설명과 우선순위를 확인하고 저장하세요.</p>
            </div>
            {features.map((feature, index) => (
              <fieldset key={index}>
                <legend>기능 {index + 1}</legend>
                <div className="form-row">
                  <label>
                    기능 이름
                    <input
                      required
                      maxLength={200}
                      value={feature.title}
                      onChange={(event) =>
                        setFeatures((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, title: event.target.value } : item
                          )
                        )
                      }
                    />
                  </label>
                  <label>
                    우선순위
                    <select
                      value={feature.priority}
                      onChange={(event) =>
                        setFeatures((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, priority: event.target.value as RequirementFeature["priority"] }
                              : item
                          )
                        )
                      }
                    >
                      <option value="MUST">MUST</option>
                      <option value="SHOULD">SHOULD</option>
                      <option value="COULD">COULD</option>
                      <option value="WONT">WON&apos;T</option>
                    </select>
                  </label>
                </div>
                <label>
                  설명
                  <textarea
                    required
                    maxLength={5000}
                    rows={3}
                    value={feature.description}
                    onChange={(event) =>
                      setFeatures((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, description: event.target.value } : item
                        )
                      )
                    }
                  />
                </label>
                <label>
                  완료 기준
                  <textarea
                    maxLength={5000}
                    rows={2}
                    value={feature.acceptanceCriteria}
                    onChange={(event) =>
                      setFeatures((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, acceptanceCriteria: event.target.value } : item
                        )
                      )
                    }
                  />
                </label>
                <button
                  type="button"
                  className="remove-feature"
                  disabled={features.length === 1}
                  onClick={() =>
                    setFeatures((current) => current.filter((_, itemIndex) => itemIndex !== index))
                  }
                >
                  <Trash size={16} /> 이 기능 제거
                </button>
              </fieldset>
            ))}
            <button
              type="button"
              className="add-row"
              onClick={() =>
                setFeatures((current) => [
                  ...current,
                  { title: "", description: "", priority: "SHOULD", acceptanceCriteria: "" }
                ])
              }
            >
              <Plus size={17} /> 기능 추가
            </button>
            <div className="form-row">
              <label>
                확인된 가정
                <textarea
                  name="assumptions"
                  rows={5}
                  placeholder="한 줄에 하나씩 입력"
                  defaultValue={latest?.assumptions.join("\n") ?? ""}
                />
              </label>
              <label>
                열린 질문
                <textarea
                  name="questions"
                  rows={5}
                  placeholder="한 줄에 하나씩 입력"
                  defaultValue={latest?.questions.map((item) => item.content).join("\n") ?? ""}
                />
              </label>
            </div>
            <button type="submit" className="primary-button" disabled={busy}>
              {busy ? <CircleNotch className="spin" /> : <CheckCircle size={18} />} 사용자 확정 revision 저장
            </button>
          </form>
        ) : (
          <div className="structured-empty">
            <p>
              원문에서 기능, 제약과 열린 질문을 분리하면 견적 항목과 근거를 더 정확하게 연결할 수 있습니다.
            </p>
          </div>
        )}
        <div className="intake-next">
          <button type="button" className="primary-button" onClick={onContinue}>
            AI 분석으로 이동 <ArrowRight size={18} />
          </button>
        </div>
      </div>
    </section>
  );
}
