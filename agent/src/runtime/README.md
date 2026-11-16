# `agent/src/runtime` 모듈 책임 구분

`agent/src/runtime/`의 36개 구현 모듈은 하위 호환성(`from runtime.<module> import ...`)을 유지하되, 역할에 따라 5개 책임 영역으로 구분해 관리한다.

## 1. Run Lifecycle & Execution (실행 수명주기·부트스트랩)

- `runs.py`, `run_contracts.py`, `run_state.py`, `run_progress.py` — 실행 조정, 상태 전이, 계약 정의
- `execution_events.py`, `executor.py`, `react_loop.py`, `internal_delegation.py` — 실행 루프 및 이벤트 생성
- `bootstrap.py`, `composition.py`, `lifespan.py` — FastAPI 수명주기 및 의존성 조립
- `postgres_store.py`, `memory_store.py` — 실행 상태 영속화 저장소

## 2. Async Task Queue & Reliability (비동기 작업·신뢰성)

- `task_contracts.py`, `task_commands.py`, `task_registry.py`, `task_guard.py` — 작업 명령 inbox, 등록, 가드
- `task_attempt_events.py`, `task_reliability_store.py`, `reliability.py`, `fifo_dispatcher.py` — 재시도 예산, 서킷 브레이커, 시도 이벤트

## 3. Scheduler & Runtime Evaluation (스케줄러·성능 평가)

- `scheduler.py`, `task_scheduler_store.py`, `task_shadow.py` — 계층형 shadow 스케줄링 및 큐 관리
- `runtime_evaluation.py`, `runtime_evaluation_store.py`, `runtime_operational_metrics.py` — 런타임 평가 게이트 및 운영 지표

## 4. Research Worker & Pilot (조사 워커·파일럿)

- `research_dispatch.py`, `research_worker.py`, `research_specialist.py` — 읽기 전용 조사 워커 및 결과 펜스
- `research_pilot_readiness.py`, `research_pilot_promotion.py` — 제한적 조사 파일럿 준비·승격 게이트

## 5. Pet Conversation & Prompts (펫 대화·품질·프롬프트)

- `pet_conversation.py`, `conversation_quality.py`, `conversation_text.py`, `department_prompts.py` — AI 동료 대화 생성 및 품질 검증