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

## 근거 자료

- [제품 버전·공개 화면 이력](product-evidence.md): 캡처와 배포 범위, 합성 데이터 여부
- [검증 기록](../testing/): 실행 환경·테스트 결과·미검증 범위. 프론트엔드 검증 문서도 이 디렉터리에서 관리한다.
- [아키텍처 결정](../adr/README.md)과 [설계](../architecture/): 기술 선택과 경계
- [재현 가능한 실험](../../experiments/README.md): 데이터·평가 코드·고정 결과
- [구현 기록](../implementation/)과 [검토 기록](../reviews/): 구현 단계와 위험 평가
