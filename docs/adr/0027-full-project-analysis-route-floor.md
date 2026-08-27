# ADR-0027: 프로젝트 최초 분석은 전체 Supervisor 경로를 보장한다

- 상태: Accepted
- 결정일: 2026-08-16
- 보완: [ADR-0015](0015-llm-first-operational-routing.md)
- 부분 대체: [ADR-0028](0028-trusted-contract-routing-fast-path.md)의 LLM 이전 route 확정과 4회 model call 예산

## Context

운영 route evaluator는 문의 원문을 보고 `DIRECT_TOOL`, `SIMPLE_LLM`, `REACT_AGENT`, `SUPERVISOR`, `HUMAN_REQUIRED` 중 하나를 선택한다. 그러나 공개 Workspace의 `분석 시작`은 일반 질의 응답이 아니라 요구사항 구조화, 프로젝트 맥락 조회, 근거 검토, 견적 설계와 검증을 모두 산출해야 하는 고정 제품 workflow다.

Discord 운영 Bot처럼 데이터 구조, 명령어, CSV 입력과 운영 조건이 함께 포함된 최초 문의가 `SIMPLE_LLM`으로 분류되면 Requirements 부서 하나만 실행된다. 이 경우 모델 성능과 무관하게 제품이 약속한 근거·견적·검증 단계가 생략된다. 최초 분석 여부와 필수 산출물이 evaluator 입력에 명시되지 않았고, evaluator 결정을 제품 workflow의 최소 실행 범위보다 우선한 것이 원인이었다.

## Decision

- 내부 Agent 입력의 기본 `workflowMode`는 `PROJECT_ANALYSIS`다. 이전 Spring 버전이 값을 생략해도 동일한 기본값을 적용한다.
- `PROJECT_ANALYSIS`이면서 결정적 직접 Tool 작업이 아닌 요청은 Safety Gate의 `HUMAN_REQUIRED` 결정을 제외하고 `SUPERVISOR`보다 낮은 경로로 실행하지 않는다.
- evaluator가 더 낮은 경로를 제안하면 후보를 감사 정보로 보존하고 `PROJECT_ANALYSIS_FULL_WORKFLOW` 정책으로 `SUPERVISOR`에 상향한다.
- 전체 분석은 Requirements, Research, Deal Design, Verification 네 부서와 최소 hierarchy depth 2, handoff 3, route 포함 model call 5회, Tool call 1회 이상의 예산을 요구한다. 부족한 예산으로 일부 부서만 조용히 실행하지 않고 `PROJECT_ANALYSIS_BUDGET_INSUFFICIENT`로 실패한다.
- `AD_HOC`은 경로별 실험과 향후 제한된 내부 작업에만 명시적으로 사용한다. 공개 프로젝트 분석 요청에는 사용하지 않는다.
- Frontend는 네 부서를 수용하는 예산을 요청하고, 최근 활동에 최종 경로·정책 사유·evaluator 후보를 구분해 표시한다.
- 실행 그래프는 선택 경로에서 실행하지 않는 단계를 `완료`로 표시하지 않고 `해당 없음`으로 표시한다.

## Consequences

### 장점

- 최초 문의의 문장 형태와 관계없이 견적에 필요한 전체 부서 검토가 보장된다.
- route evaluator의 오분류가 제품 산출물 누락으로 이어지지 않는다.
- 후보 경로와 정책 상향을 함께 기록해 routing 품질 평가 자료를 유지한다.
- 부족한 실행 예산이 부분 결과로 위장되지 않는다.

### 비용과 한계

- 짧고 단순한 프로젝트 문의도 네 부서 workflow를 실행하므로 모델 호출 비용과 지연이 증가한다.
- `SUPERVISOR` 실행 자체가 결과 품질을 보장하지 않으므로 질문 수, 견적 근거와 사용자 수정률을 계속 측정해야 한다.
- 향후 프로젝트 유형별로 더 작은 검증된 workflow를 도입하려면 별도 평가와 ADR이 필요하다.
