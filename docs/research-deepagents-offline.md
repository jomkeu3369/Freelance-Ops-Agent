# Research Deep Agents 오프라인 준비

기준: `a8a764ce66dbb08d3752db929cb781bdc87ede7b`의 주간 크레딧·플랫폼 원가 guard.

## 현재 범위

- 기존 Research 실행 계약과 Deep Agents의 호환성을 **네트워크 없는 fixture**로 검증한다.
- `agent/src/evaluation/research_adapter.py`의 `OfflineDeepResearchExecution`은 정확한
  `ScriptedResearchModel` 타입과 메모리 안의 고정 출처만 받는다. HTTP client,
  API key, 실제 provider 생성 경로가 없다.
- 실제 `create_deep_agent` graph, LangChain model interface, `ToolStrategy(ResearchOutput)`,
  `StateBackend`, `InMemorySaver`를 사용한다. 기존 `ResearchTaskWorker`, `TaskGuard`,
  `ResearchResultVerifier`, 결과 fence와의 계약을 시험한다.
- `agent/src/runtime/research_engine.py`의 선택 정책은 기본 off다. off는 기존 실행기를
  그대로 반환하고, true는 `PLATFORM_DEEP_RESEARCH_NOT_ADMITTED`로 거부한다.
  **main/config/FIFO에는 새 엔진을 연결하지 않았다.** 환경변수나 요청 값으로 활성화할 수 없다.
- 신규 의존성, DB migration, frontend 변경, 배포, 유료 API 호출은 없다.

## 비용 및 권한 경계

기존 `PlatformSpendLedger`를 그대로 사용해 예약/사용량 동작만 시뮬레이션한다.
`offline.research.fixture` 기록의 토큰과 원가는 실제 API 측정값이 아니며,
운영 원장에 게시하거나 사용자의 크레딧을 차감하는 데 사용하면 안 된다.
모의 모델의 모든 호출은 같은 root ledger에 예약된다. 실패·취소·usage 유실은 예약
상한을 유지한다. 새 예약을 만드는 하위 에이전트나 별도의 가격 계산기는 없다.

이 evaluator는 단일 task만 지원하므로 root `RunBudget`과 task `RunBudget`이 정확히
같아야 한다. root 예산이 더 크더라도 task 제한을 넓혀 쓰지 않는다. 실제 root 아래
여러 task를 병렬 실행하려면 task별 atomic sub-allocation을 별도로 검증해야 한다.

허용 도구는 고정 자료를 읽는 `web_research` 및 경로 제한을 적용하는 읽기 전용
filesystem 도구다. 도구가 모델에 보이지 않는다는 사실을 권한 검사로 취급하지 않는다.
실제 dispatch middleware가 shell, subagent, 파일 쓰기, 임의 도구를 거부하고 모든
실행 도구 호출을 같은 tool budget에서 센다. model-object 전용 안전 profile을
사용하므로 `subagents=[]`만으로 범용 subagent가 꺼진다고 가정하지 않는다.

fixture 실행 중 LangSmith tracing은 명시적으로 꺼진다. 테스트는 ambient tracing
설정을 켠 상태에서도 socket 연결을 차단하고, background에서 예외를 삼킨 연결
시도도 실패 처리한다. 기존 테스트의 offline provider 우회 seam은 비활성화한다.

## 21개 핵심 fixture

| ID | 사례 | 기대 결과 |
| --- | --- | --- |
| 01 | 단일 출처 | 구조화 결과와 인용·호출 사용량 계약 일치 |
| 02 | 상충 출처 | scripted 불확실성 및 두 출처 보존 |
| 03 | 출처 없음 | 근거 필수 오류 |
| 04 | 존재하지 않는 인용 ID | 인용 검증 오류 |
| 05 | 인용 없는 문단 | 검증 오류 |
| 06 | stale authorization revision | 모델 호출 전 거부 |
| 07 | stale budget revision | 모델 호출 전 거부 |
| 08 | 다른 workspace의 attempt | 모델 호출 전 거부 |
| 09 | 다른 run 파일 읽기 | 파일 권한 거부 |
| 10 | 외부 자료의 shell 지시를 모의 실행 | shell dispatch 거부 |
| 11 | 소진된 원가 예산 | 모델 예약·도구 실행 0회 |
| 12 | 정확한 한도 | 첫 예약 허용, 다음 예약 거부 |
| 13 | 병렬 예약 경쟁 | root 잔액 초과 불가 |
| 14 | 요약·재시도 원가 모의 기록 | 동일 root ledger 합산 |
| 15 | usage 유실 | 최초 예약 상한 보존 |
| 16 | 호출 전 취소 | 원가 예약 없음 |
| 17 | 예약 후 취소 | 원가 상한 보존, 후속 도구 없음 |
| 18 | in-memory checkpoint 재개 | 완료된 도구·모델 호출 재실행 없음 |
| 19 | hard redirect | 이전 revision 결과 폐기 |
| 20 | 기본 off / true 요청 | 기존 실행기 한 번 / 미승인 엔진 거부 |
| 21 | 호출 시작 후 실패 | 기존 엔진 fallback 없음, 같은 attempt 재시도 거부 |

추가 회귀 검사는 source_ids 불일치, ledger 부재, 실제 guard의 native tool payload
거부, task/write/custom tool 차단, filesystem tool 예산, 잘못된 route, 기존 worker의
완료 이벤트와 late-result fence, task/root budget 불일치, checkpoint 전 deadline 유지,
희소·역순 인용 ID의 결과 출처 배열 정렬, 동시 중복 실행의 직렬화, 외부 callback/cache/rate-limiter 거부를 다룬다.

## 해석하면 안 되는 결과

- scripted 응답이므로 사실성, 모델의 충돌 해결 능력, prompt-injection 저항성,
  실제 비용 절감이나 latency 개선을 입증하지 않는다.
- 14번은 ledger의 중첩 사용량 합산 검사다. 실제 긴 문맥 summarization을 강제로
  발생시키는 성능 시험이 아니다. 내부 offload 경로와 긴 문맥 동작은 추가 검증 대상이다.
- checkpoint는 같은 프로세스의 `InMemorySaver`와 살아 있는 fixture 상태를 사용한다.
  재시작·다중 worker·DB 장애 복구나 분산 취소를 입증하지 않는다. fixture deadline은
  최초 실행부터 checkpoint 대기 시간을 포함한다.
- 인용 verifier는 구조·출처 메타데이터를 검사한다. 문장과 근거의 의미적 일치 여부는
  별도 평가가 필요하다. adapter는 반환되는 출처 순서에 맞게 인용 번호를 재매핑한다.

## 라이브 실행 전에 남은 gate

1. **Native tool payload admission**: 현재 `budgeted_openai_attempt`는 `tools=[]`인
   text-only Responses 요청만 받는다. Deep Agents의 tool schema/call/result,
   response schema, context compaction을 포함하는 정확한 leaf HTTP payload와
   모든 billable attempt의 상한을 검증하기 전에는 ChatModel을 연결하지 않는다.
2. **유료 Research tool admission**: 현재 paid web research/embedding은 fail closed다.
   검색·fetch 비용의 사전 예약과 오류/취소 정산 계약 없이는 풀지 않는다.
3. **Durable attempt/ledger**: detached Research FIFO는 아직 admission이 없다.
   durable checkpoint와 root reservation 연결, task별 budget, run/attempt idempotency,
   재개 시 기존 사용량·원래 reservation·expiry 유지가 필요하다.
4. **현재 권한·취소 재검증**: 현재 Research command 경로의 PAUSE/RESUME를 완성 기능으로
   가정하지 않는다. 실행 전/각 호출 전/결과 반영 시 권한·예산 revision과 취소를 검증한다.
5. **별도 승인된 live 검증**: 실제 model alias, service tier, token bound, 구조화 출력,
   품질·비용·latency 평가가 필요하다. offline 성공은 실행/배포 승인이 아니다.

호출 전 구성 오류의 fallback을 추가하더라도 첫 외부 호출 전에만 선택해야 한다.
후보 엔진에서 비용이 발생한 뒤 baseline을 자동 실행하지 않는다. 완료된 비교 결과를
근거로 실행기 선택을 접수 시 snapshot에 고정하고 검증된 영역부터 확장한다.

## 재현

프로젝트 표준 검증은 `agent/`에서 `uv sync --locked`, `uv run --locked pytest`,
`uv run --locked ruff check src tests`, `uv run --locked mypy src`다.
집중 검증은 `uv run --locked pytest tests/evaluation/test_research_adapter.py`로 실행한다.

이번 환경에서는 이전 guard 검증용 Python 3.12 환경을 재사용했다.
Deep Agents/LangChain/LangGraph 관련 버전은 lock과 일치하며, 전체 `uv sync --locked`를
새로 실행한 것은 아니다. 집중 40개와 전체 426개가 통과했고 PostgreSQL 환경 테스트
8개는 건너뛰었다. Ruff 및 mypy 88개 source 파일 검증도 통과했다.
