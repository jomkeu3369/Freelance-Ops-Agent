# 포트폴리오용 기술 기록

이 디렉터리는 저장소의 실험 결과, ADR과 구현 근거를 기업 지원용 포트폴리오로 재구성하기 위한 문서를 보관한다. 운영 완료로 오해할 수 있는 표현은 피하고, 구현·오프라인 평가·운영 예정 항목을 구분한다.

## Case studies

| 주제 | 핵심 내용 | 문서 |
|---|---|---|
| AI 신뢰성·라우팅 | RAG answerability와 Agent route를 평가해 local-first 가설을 검증하고 fail-closed LLM 구조로 전환 | [RAG Answerability와 Agent Routing 신뢰성 개선](ai-routing-and-rag-reliability-case-study.md) |
| AI Platform | 모델 실험을 Gateway 정책, CI release gate, 부하 검증, SLO와 Runbook으로 연결 | [실험을 배포 결정으로 연결한 AI Platform Engineering](ai-platform-engineering-case-study.md) |

## 활용 원칙

- 수치는 연결된 JSON·plot·테스트 또는 ADR로 재현 가능한 것만 사용한다.
- 실제 사용자 트래픽, 운영 배포, 매출 효과로 검증하지 않은 항목은 그렇게 표현하지 않는다.
- private prompt, API key, 사용자 데이터와 로컬 절대 경로는 포트폴리오에 포함하지 않는다.
- 지원 회사에 맞춰 요약 문구를 바꾸더라도 평가 결과와 한계는 유지한다.
