# 검증 기록 안내

파일별 날짜·기준 커밋·환경·통과/실패/생략을 함께 읽는다. 과거 보고서의 ‘현재’는 그 검사 시점이며, 조건부 생략과 테스트 수집은 실행 통과가 아니다. 최신 서비스 검증·배포는 [제품 근거](../portfolio/product-evidence.md), 실행 명령은 서비스별 README를 따른다.

합성 화면·모의 응답·로컬 성능·실제 DB·운영 배포·유료 모델은 서로 다른 근거다. 숫자와 실패 기록은 그 조건 안에서 보존한다.

## 현재 사용량 API

- [실제 비용 기반 사용량 API](platform-usage-api-2026-10-05.md)

## 화면·개인 연결·사용량 통합

- [펫과 함께하는 견적 작성 검증 — 2026-10-19](pet-quotation-readiness-2026-10-19.md)
- [개인 AI 연결 검증 — 2026-09-12](byok-connections-2026-09-12.md)
- [업무 공간 기능 통합 검증 — 2026-10-05](cloud-feature-integration-2026-10-05.md)
- [AI 펫 핵심 흐름 검증 (2026-09-12)](frontend-ai-pets-2026-09-12.md)
- [프런트엔드 의존성 보안 점검 — 2026-10-11](frontend-dependency-audit-2026-10-11.md)
- [Figma 기반 프론트엔드 검증 — 2026-09-11](frontend-figma-verification-2026-09-11.md)
- [Frontend 구현·검증 기준선 — 2026-08-15](frontend-implementation-baseline-2026-08-15.md)
- [프론트엔드 실제 서버 통합 검증 — 2026-09-11](frontend-integration-2026-09-11.md)
- [메인 소개 화면 개선·검증 — 2026-09-12](frontend-landing-2026-09-12.md)
- [반응형 프론트엔드 UX 구현·검증 — 2026-09-11](frontend-responsive-ux-2026-09-11.md)
- [UI 개선 배포 범위 — 2026-10-01](frontend-ui-release-2026-10-01.md)
- [전체 화면 프로젝트 대화 검증](fullscreen-chat-verification.md)
- [로그인 화면·영상 검증 — 2026-10-05](login-ui-2026-10-05.md)
- [모델 예산 통합 검증 — 2026-10-05](model-budget-cloud-verification-2026-10-05.md)
- [모델 카탈로그·가격표 검증 — 2026-10-05](model-catalog-2026-10-05.md)
- [업무 공간 제어·사용량 표시 검증 — 2026-10-05](workspace-controls-2026-10-05.md)
- [전체 화면 업무 공간·사용량 계약 통합 — 2026-10-04](workspace-credit-integration-2026-10-04.md)

## 회원·첨부·OCR

- [관리자 회원·로그인 조회](admin-members-2026-10-05.md)
- [첨부파일 PostgreSQL 통합 검증 — 2026-10-05](chat-attachment-postgres-2026-10-05.md)
- [OCR 추출 범위와 명시적 옵션 설계 — 2026-10-07](ocr-coverage-design-2026-10-07.md)
- [OCR 구조 수정 검증 — 2026-10-07](ocr-coverage-validation-2026-10-07.md)
- [RapidOCR 후보 자원 평가 — 교체 gate 미통과](ocr-rapidocr-feasibility-2026-10-07.md)

## 운영 준비와 장애·복구

- [운영 준비 자동 점검 — 2026-09-05](production-readiness-2026-09-05.md)
- [운영 준비 점검 보완 결과 — 2026-09-05](production-readiness-remediation-2026-09-05.md)

## 검색·라우팅 연구

- [Hybrid Router 단독 평가 — 2026-08-13](hybrid-router-standalone-evaluation.md)
- [Retrieval Answerability Pipeline 평가와 도입 결정](retrieval-answerability-pipeline.md)
- [Local Router 분포 이동·OOD 평가 — 2026-08-27](routing-distribution-shift-ood-2026-08-27.md)
- [운영 Routing Policy Replay — 2026-08-27](routing-operational-policy-replay-2026-08-27.md)
- [실서비스 Routing 관측·검토 파이프라인 — 2026-08-27](routing-production-shadow-collector-2026-08-27.md)
- [Routing Review Canary 판정력 연구 — 2026-08-27](routing-review-canary-power-2026-08-27.md)
- [Routing Review 순차 Canary 판정 연구 — 2026-08-27](routing-review-canary-sequential-2026-08-27.md)
- [Routing Human Review 동시성 연구 — 2026-08-27](routing-review-claim-concurrency-2026-08-27.md)
- [Routing Gold Label Consensus 연구 — 2026-08-27](routing-review-consensus-2026-08-27.md)
- [Routing Review 공통오류 Robustness 연구 — 2026-08-27](routing-review-consensus-robustness-2026-08-27.md)
- [Routing Review 고정 Cohort Export 연구 — 2026-08-27](routing-review-export-cohort-2026-08-27.md)
- [Routing Review 표본 편향 보정 연구 — 2026-08-27](routing-review-sampling-bias-2026-08-27.md)
- [Shadow Routing 운영 수집·검토 용량 연구 — 2026-08-27](routing-shadow-collection-capacity-2026-08-27.md)
- [운영 Shadow Trace 평가 파이프라인 — 2026-08-27](routing-shadow-trace-pipeline-2026-08-27.md)

## 스케줄러 연구

- [Adaptive Hierarchical Scheduler 실험](scheduler-adaptive-hierarchical-experiment-2026-08-27.md)
- [Scheduler Autoscaling Strategy Experiment](scheduler-autoscaling-experiment-2026-08-27.md)
- [Failure Classifier와 Secondary Provider 운영 경계 실험](scheduler-failure-classifier-provider-envelope-2026-08-27.md)
- [Adaptive Hierarchical Scheduler 신뢰성 경계 실험](scheduler-hierarchical-reliability-experiment-2026-08-27.md)
- [Hierarchical Scheduler Retry·Checkpoint·Failover 결합 실험](scheduler-hierarchical-retry-failover-experiment-2026-08-27.md)
- [Multi-signal Failure Classifier 실험 보고서](scheduler-multi-signal-failure-classifier-experiment-2026-08-27.md)
- [Scheduler Overload Admission Experiment](scheduler-overload-admission-experiment-2026-08-27.md)
- [Scheduler Retry·Checkpoint Resume 실험](scheduler-retry-checkpoint-experiment-2026-08-27.md)
- [Scheduler Scale 실패·Fallback·비용 실험](scheduler-scaling-reliability-cost-experiment-2026-08-27.md)
- [Scheduler Shadow Replay 준비도 보고서](scheduler-shadow-replay-readiness-2026-08-27.md)
- [TaskAttempt Telemetry Shadow Contract 실험 보고서](scheduler-task-attempt-telemetry-shadow-contract-experiment-2026-08-27.md)
- [Multi-tenant Scheduler 공정성·Priority SLO 실험](scheduler-tenant-fairness-experiment-2026-08-27.md)
- [Workspace Retry Token Bucket 실험 보고서](scheduler-workspace-retry-token-bucket-experiment-2026-08-27.md)

## OCR 원자료와 재현

- [추출 범위 비교 CSV](ocr-coverage-comparison-2026-10-07.csv)
- [RapidOCR 자원 검증 CSV](ocr-rapidocr-feasibility-2026-10-07.csv)
- [후보 재현 환경·고정 잠금·해시·실행기](ocr-rapidocr-repro/README.md)

CSV·실험 기준·모델 manifest·잠금 파일·실행기는 당시 결과의 재현 자료다. 문장이나 디렉터리를 정리하면서 원본 값·해시·제한을 바꾸지 않는다.
