import { useState } from "react";
import { outcomes } from "../home-content";

export function OutcomeSection() {
  const [outcomeIndex, setOutcomeIndex] = useState(0);
  const selectedOutcome = outcomes[outcomeIndex];

  return (
    <section className="chapter outcome-section">
      <div className="outcome-copy">
        <p className="section-context">완료 결과를 다음 판단으로</p>
        <h2>끝난 프로젝트가,<br />다음 견적의 근거가 됩니다.</h2>
        <p>AI가 스스로 학습한다는 의미가 아니라, 사용자가 승인한 실제 결과를 검색 근거로 재사용합니다.</p>
      </div>
      <div className="outcome-carousel" aria-live="polite">
        <div className="outcome-card">
          <span>예시 기록</span>
          <h3>{selectedOutcome.title}</h3>
          <strong>{selectedOutcome.metric}</strong>
          <p>{selectedOutcome.body}</p>
        </div>
        <div className="outcome-controls">
          {outcomes.map((outcome, index) => (
            <button
              key={outcome.title}
              type="button"
              className={index === outcomeIndex ? "active" : ""}
              onClick={() => setOutcomeIndex(index)}
              aria-label={`${outcome.title} 보기`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
