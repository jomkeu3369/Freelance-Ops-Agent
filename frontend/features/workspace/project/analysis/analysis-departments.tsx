import { AgentRunView } from "../../../../app/lib/api";
import { ArrowRight } from "@phosphor-icons/react";
import { departmentLabels } from "../../shared/constants";
import { externalHttpUrl } from "../../shared/formatters";

type DepartmentResults = NonNullable<AgentRunView["result"]>["departmentResults"];

export function AnalysisDepartments({ results }: { results: DepartmentResults }) {
  if (results.length === 0) return null;

  return (
    <details className="department-results">
      <summary>
        <span>분석 단계별 상세</span>
        <small>{results.length}개 결과</small>
      </summary>
      <div>
        {results.map((result) => (
          <article key={result.department}>
            <strong>{departmentLabels[result.department] ?? "분석 단계"}</strong>
            <p>{result.summary}</p>
            <small>
              근거 {result.evidenceIds.length} · 가정 {result.assumptionIds.length}
            </small>
            {result.sources.length > 0 && (
              <details className="run-sources">
                <summary>검토 가능한 출처 {result.sources.length}개</summary>
                <ul>
                  {result.sources.map((source, index) => {
                    const safeUrl = externalHttpUrl(source.url);
                    return (
                      <li key={`${source.url}-${index}`}>
                        <div>
                          <span>{source.title}</span>
                          <small>
                            {source.provider}
                            {source.jurisdiction ? ` · ${source.jurisdiction}` : ""}
                          </small>
                        </div>
                        {source.excerpt && <p>{source.excerpt}</p>}
                        {safeUrl ? (
                          <a href={safeUrl} target="_blank" rel="noopener noreferrer">
                            원문 열기 <ArrowRight size={13} />
                          </a>
                        ) : (
                          <code>{source.url}</code>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </details>
            )}
          </article>
        ))}
      </div>
    </details>
  );
}
