import { useState } from "react";
import { evidenceExamples } from "../home-content";

export function EvidenceSection() {
  const [evidenceIndex, setEvidenceIndex] = useState(0);
  const selectedEvidence = evidenceExamples[evidenceIndex];

  return (
    <section id="evidence" className="chapter evidence-section">
      <div className="evidence-copy">
        <p className="section-context">근거가 먼저 보이는 화면</p>
        <h2>빠른 답변보다,<br />설명 가능한 결과를 우선합니다.</h2>
        <p>견적에 사용한 자료, 반영한 수치, 계산식과 확인되지 않은 가정을 함께 보여줍니다.</p>
      </div>
      <div className="bento-grid evidence-grid scale-fade">
        <article className="quote-item-preview">
          <div className="preview-toolbar">
            <span>견적 항목 · 제품 예시</span>
            <strong>사용자 확인 필요</strong>
          </div>
          <div className="evidence-item-list" role="listbox" aria-label="견적 항목 선택">
            {evidenceExamples.map((item, index) => (
              <button
                type="button"
                role="option"
                aria-selected={index === evidenceIndex}
                key={item.title}
                onClick={() => setEvidenceIndex(index)}
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{item.title}</strong>
                <small>{item.effort}</small>
              </button>
            ))}
          </div>
          <dl>
            <div>
              <dt>예상 공수</dt>
              <dd>{selectedEvidence.effort}</dd>
            </div>
            <div>
              <dt>적용 단가</dt>
              <dd>{selectedEvidence.rate}</dd>
            </div>
            <div>
              <dt>계산</dt>
              <dd>{selectedEvidence.calculation}</dd>
            </div>
            <div>
              <dt>가정</dt>
              <dd>{selectedEvidence.assumption}</dd>
            </div>
          </dl>
        </article>
        <aside className="evidence-drawer" aria-live="polite">
          <span className="drawer-handle" />
          <h3>{selectedEvidence.title}<br />연결 근거</h3>
          {selectedEvidence.sources.map(([title, body]) => (
            <div key={title}>
              <strong>{title}</strong>
              <p>{body}</p>
            </div>
          ))}
        </aside>
      </div>
    </section>
  );
}
