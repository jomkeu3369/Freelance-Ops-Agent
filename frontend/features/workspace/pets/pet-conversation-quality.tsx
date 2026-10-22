import type { AgentRunView } from "../../../app/lib/api";
import { useT } from "../../../app/lib/ui-language";

export function conversationVerified(run: AgentRunView | null): boolean {
  return !!run?.result?.departmentResults.some(result => result.department === "VERIFICATION"
    && result.status === "COMPLETED" && !result.errorCode);
}

function sourceUrl(value: string): string | null {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}

export function PetConversationQuality({ run }: { run: AgentRunView | null }) {
  const t = useT();
  if (!run?.result?.petMessages?.length) return null;
  const research = run.result.departmentResults.find(result => result.department === "RESEARCH");
  const review = run.result.departmentResults.find(result => result.department === "VERIFICATION");
  const verified = conversationVerified(run);
  return <section className="pet-conversation-quality" aria-label={t("조사와 독립 검증")}>
    <details className="pet-conversation-quality-report" open={!verified}>
    <summary><span>{t("조사와 독립 검증")}</span><strong role="status">{verified ? t("검토 완료") : t("확인 필요")}</strong></summary>
    <div className="pet-conversation-quality-body">
    <p>{verified ? t("요구사항·공수·근거 검토 완료") : t("검증이 완료되어야 제안을 반영할 수 있습니다.")}</p>
    {research && <><p className="model-selection-note">{research.summary}</p>
      {research.sources?.map(source => {
        const href = sourceUrl(source.url);
        return <details className="pet-conversation-evidence" key={`${source.url}:${source.contentSha256}`}>
          <summary>{source.title}</summary>
          {href && <a href={href} target="_blank" rel="noopener noreferrer">{t("원문 보기")}</a>}
          {source.fetchedAt && Number.isFinite(Date.parse(source.fetchedAt)) && <p className="model-selection-note">{t("조회 시각")}: {new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(source.fetchedAt))}</p>}
          <p>{source.excerpt}</p>
        </details>;
      })}
    </>}
    {review && <details className="pet-conversation-evidence" open={!verified && review.status !== "PENDING"}>
      <summary>{t("검증 결과 확인")}</summary><p>{review.summary}</p>
    </details>}
    <p className="model-selection-note">{t("별도의 AI 호출로 검토한 초기 추정입니다. 최종 범위와 공수는 직접 확인해 주세요.")}</p>
    </div></details>
  </section>;
}
