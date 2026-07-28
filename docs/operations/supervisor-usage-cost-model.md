# Supervisor 사용량 기반 비용 계산 모델

> 문서 상태: Draft v0.1
> 작성일: 2026-07-28
> 적용 범위: Global Orchestrator, Department Supervisor, Specialist Agent, 결정적 Tool과 외부 조사 Provider

## 1. 목적

완성된 Supervisor 구조의 비용을 사용자 요청 횟수만으로 단순 계산하면
실제 원가와 큰 차이가 생긴다. 동일한 요청 한 건도 route, 실행 부문,
ReAct turn, Tool 호출, 재시도와 HITL 여부에 따라 비용이 달라지기 때문이다.

따라서 비용은 다음 두 단계로 계산한다.

```text
실행 시점: Agent run별 실제 원가 ledger
집계 시점: route별 사용 횟수 × route별 관측 평균 원가
```

모델과 외부 Provider의 단가, 환율과 세금은 코드에 고정하지 않고
`pricing_snapshot_id`로 versioning한다. 이 문서의 수식에는 실제 단가 대신
versioned pricing configuration의 값을 대입한다.

## 2. 비용 계산 단위

### 2.1 요청 route

V2의 요청 등급을 비용 집계 단위로 사용한다.

| Route | 설명 | 주요 비용 발생원 |
|---|---|---|
| `DIRECT_TOOL` | LLM 없이 결정적 조회·계산만 실행 | Tool, API와 소량의 infra |
| `SINGLE_AGENT` | Specialist Agent 하나가 제한된 ReAct 실행 | 모델, Tool |
| `DEPARTMENT` | Department Supervisor와 하나 이상의 Specialist 실행 | Supervisor, Specialist, Tool |
| `MULTI_DEPARTMENT` | Global Orchestrator가 여러 부문을 조정 | Global, 복수 Supervisor·Specialist, 검증 |
| `HUMAN_REQUIRED` | 실행 전 또는 실행 중 사람의 판단이 필요해 중단 | 중단 전까지 소비한 모델·Tool과 checkpoint |

`HUMAN_REQUIRED`는 무료 실행이 아니다. 중단되기 전까지 소비된 비용을 해당
run에 기록하고, 재개하면 같은 `agent_run_id`의 누적 원가에 더한다.

### 2.2 비용 분류

```text
변동비
├─ LLM 호출
├─ 검색·크롤링·외부 API Tool
├─ 신규 embedding
├─ 실행 시간에 비례하는 compute
└─ 사용량 기반 trace·log·storage

고정비
├─ 상시 실행 Spring·Agent·PostgreSQL
├─ 기본 observability·backup
├─ 고정 SaaS 구독
└─ 월별 운영·지원비
```

사용 횟수 증가에 따른 한계비용은 변동비로 계산하고, 요금제 수익성에는
고정비 배분까지 포함한다.

## 3. Agent run 한 건의 실제 비용

### 3.1 LLM 호출 비용

run `r`에서 발생한 모든 모델 호출 집합을 `M(r)`이라고 한다.

```text
C_llm(r)
= Σ[c ∈ M(r)] (
    U_c × P_input(m_c)
  + K_c × P_cached_input(m_c)
  + O_c × P_output(m_c)
  ) / 1,000,000
  + Σ[c ∈ M(r)] P_request(m_c)
```

| 기호 | 의미 |
|---|---|
| `U_c` | 호출 `c`의 cache가 적용되지 않은 input token |
| `K_c` | 호출 `c`의 cached input token |
| `O_c` | 호출 `c`의 billable output token |
| `m_c` | 호출에 사용한 provider·model·pricing version |
| `P_input` | 100만 uncached input token당 단가 |
| `P_cached_input` | 100만 cached input token당 단가 |
| `P_output` | 100만 billable output token당 단가 |
| `P_request` | Provider가 request 단위로 부과할 때의 호출당 단가 |

Provider usage가 reasoning token을 billable output에 포함한다면 `O_c`에
포함하고 별도로 중복 계산하지 않는다. Provider가 별도 항목으로 청구할
경우에만 해당 pricing field를 추가한다.

Supervisor 구조에서는 모든 model call을 더한다.

```text
M(r)
= Global Orchestrator 호출
 + 실행된 Department Supervisor 호출
 + 실행된 Specialist 호출
 + Validation Agent 호출
 + structured output 수정 호출
 + retry와 fallback 호출
```

병렬 실행은 latency 계산에서는 최댓값을 사용할 수 있지만 비용 계산에서는
모든 병렬 호출의 합계를 사용한다.

### 3.2 Tool과 외부 Provider 비용

run `r`의 Tool 종류 집합을 `J(r)`이라고 한다.

```text
C_tool(r) = Σ[j ∈ J(r)] N_rj × P_tool(j)
```

복합 단가가 있는 Tool은 하위 사용량으로 분리한다.

```text
C_research(r)
= N_search_query × P_search_query
 + N_search_credit × P_search_credit
 + N_crawled_page × P_crawled_page
 + N_pdf_page × P_pdf_page
 + N_external_api × P_external_api
```

Spring의 결정적 내부 Tool은 외부 API 사용료가 없더라도 실행 시간과
database 사용량을 variable infra에 반영할 수 있다.

### 3.3 Embedding 비용

검색만 수행한 run에서 이미 저장된 embedding 비용을 다시 부과하지 않는다.
새 문서 ingest나 re-index가 발생한 경우에만 계산한다.

```text
C_embedding(r)
= E_new_token(r) × P_embedding(model, version) / 1,000,000
```

공통 공식 문서 ingest 비용은 개별 사용자 run에 중복 부과하지 않고
공통 운영비 또는 문서 corpus별 amortization으로 분리한다.

### 3.4 변동 infrastructure 비용

```text
C_variable_infra(r)
= S_agent(r) × P_agent_second
 + S_crawler(r) × P_crawler_second
 + Q_db(r) × P_db_unit
 + B_network(r) × P_network_byte
 + B_trace(r) × P_trace_byte
 + B_storage_delta(r) × P_storage_byte_month
```

초기에는 너무 세밀한 infra 계측보다 다음 항목부터 측정한다.

```text
agent_execution_seconds
crawler_execution_seconds
trace_bytes
new_storage_bytes
```

### 3.5 run 실제 원가

```text
C_actual_run(r)
= C_llm(r)
 + C_tool(r)
 + C_embedding(r)
 + C_variable_infra(r)
```

Provider가 USD로 청구하고 내부 ledger가 KRW라면 호출 시점 또는 일별로
고정한 환율 snapshot을 사용한다.

```text
C_actual_run_krw(r)
= C_actual_run_usd(r) × FX_usd_krw(pricing_snapshot_id)
```

세금 포함 여부는 pricing snapshot의 `tax_included`로 명시하고 같은 비용을
두 번 더하지 않는다.

## 4. 재시도와 실패 비용

### 4.1 실제 비용

실제 ledger에서는 재시도 배수를 별도로 곱하지 않는다. retry와 structured
output 수정이 각각 새로운 model·Tool execution으로 기록되므로 3장의 합계에
이미 포함된다.

실패 run도 비용을 0으로 처리하지 않는다.

```text
C_failed = 실패 전까지 발생한 모든 실제 model·Tool·infra 비용
```

### 4.2 실행 전 예상 비용

실행 전에 retry 비용을 추정할 때, 한 단계의 실패 확률을 `q`, 최대 retry
횟수를 `k`라고 하면 예상 시도 횟수는 다음과 같다.

```text
A(q, k) = Σ[i=0..k] q^i
        = (1 - q^(k + 1)) / (1 - q)
```

`q=1`이면 예상 시도 횟수는 `k+1`로 계산한다.

따라서 한 단계의 예상 비용은 다음과 같다.

```text
E[C_stage] = C_single_attempt × A(q, k)
```

Global, Department, Specialist와 Tool마다 실패율이 다르므로 가능한 경우
stage별 관측 실패율을 사용한다. 데이터가 없을 때 높은 retry를 가정해
비용을 부풀리기보다 보수적인 hard cap을 함께 둔다.

## 5. 사용 횟수 기반 월 비용

route `t`의 월 사용 횟수를 `N_t`, 최근 평가 기간에서 관측한 route별 평균
실제 변동비를 `C̄_t`라고 한다.

```text
C_month_variable
= N_direct × C̄_direct
 + N_single × C̄_single
 + N_department × C̄_department
 + N_multi_department × C̄_multi_department
 + N_human_required × C̄_human_required
```

월 총원가는 다음과 같다.

```text
C_month_total
= C_month_fixed
 + C_month_variable
 + C_one_off_amortized
```

요청 구성비 `w_t`와 총 요청 수 `N_total`만 알고 있을 때는 다음처럼
추정한다.

```text
N_t = N_total × w_t

C̄_weighted_run = Σ[t] w_t × C̄_t

C_month_total
= C_month_fixed
 + N_total × C̄_weighted_run
 + C_one_off_amortized
```

route 비율의 합은 반드시 1이어야 한다.

```text
Σ[t] w_t = 1
```

## 6. 성공 산출물당 원가

V2의 핵심 원가 지표는 API 호출당 비용이 아니라 성공한 산출물당 비용이다.

평가 기간의 전체 run 집합을 `R`, 성공한 billable outcome 수를 `B`라고 한다.

```text
C_variable_per_success
= Σ[r ∈ R] C_actual_run(r) / B
```

실패, 취소, schema 오류와 rate limit로 소비한 비용도 분자에 포함한다.

고정비까지 포함한 완전 원가는 다음과 같다.

```text
C_full_per_success
= (
    C_month_fixed
  + Σ[r ∈ R] C_actual_run(r)
  + C_one_off_amortized
  ) / B
```

사용자별 월 원가는 다음 식으로 집계한다.

```text
C_user_month(u)
= Σ[t] N_u,t × C̄_u,t
 + C_fixed_allocated(u)
```

고정비 배분은 회계 목적에 따라 활성 유료 사용자 균등 배분 또는 사용량
가중 배분 중 하나를 선택하고 policy version을 기록한다.

## 7. 수익성 guardrail

V2 초기 guardrail인 “성공 산출물의 변동비가 순매출의 20% 이하”를 적용하면
필요한 최소 순매출은 다음과 같다.

```text
Required_net_revenue_per_success
>= C_variable_per_success / 0.20
>= 5 × C_variable_per_success
```

목표 공헌이익률을 `M`, 결제·마켓 수수료율을 `F`라고 할 때 참고용 최소
판매가는 다음과 같다.

```text
Minimum_price
>= (
    C_full_per_success
  + C_support_per_success
  + C_fixed_payment_fee
  ) / (1 - M - F)
```

이 식을 사용할 때 `M + F < 1`이어야 한다.

이 식은 API 원가만으로 판매 가격을 결정하라는 의미가 아니다. 실제 판매
가격은 지불 의사와 산출물 가치를 먼저 검증하고, 비용식은 손실 방지와
quota 설계에 사용한다.

## 8. 계산 예시

다음 값은 실제 Provider 가격이 아닌 수식 검증용 가상 값이다.

| Route | 월 사용 횟수 | 관측 평균 변동비 |
|---|---:|---:|
| `DIRECT_TOOL` | 200 | 5원 |
| `SINGLE_AGENT` | 500 | 40원 |
| `DEPARTMENT` | 250 | 100원 |
| `MULTI_DEPARTMENT` | 50 | 250원 |
| `HUMAN_REQUIRED` | 20 | 30원 |

```text
C_month_variable
= 200 × 5
 + 500 × 40
 + 250 × 100
 + 50 × 250
 + 20 × 30
= 59,100원
```

월 고정비가 300,000원이고 월 성공 산출물이 900건이라면 다음과 같다.

```text
C_variable_per_success = 59,100 / 900 = 약 65.7원

C_full_per_success
= (300,000 + 59,100) / 900
= 399원
```

20% 변동비 guardrail만 적용한 최소 순매출 참고값은 다음과 같다.

```text
Required_net_revenue_per_success
>= 65.7 / 0.20
>= 약 329원
```

고정비, 지원비와 목표 이익률까지 반영한 실제 최소 판매가는 7장의 별도
식을 사용한다.

## 9. Agent 구조별 비교식

Supervisor가 단일 ReAct보다 경제적인지 판단할 때 평균 비용만 비교하지
않고 성공률을 함께 사용한다.

```text
Cost_effectiveness(structure)
= Task_success_rate(structure) / C_variable_per_run(structure)
```

보다 직접적인 비교는 다음 식을 사용한다.

```text
C_variable_per_success(structure)
= Total_variable_cost(structure)
 / Successful_billable_outcomes(structure)
```

Supervisor 승격 조건:

```text
품질 지표가 단일 Agent baseline보다 개선됨
AND C_variable_per_success가 budget 이내
AND latency·loop·failure guardrail을 충족함
```

단일 run에서 선택되지 않은 Department의 예상 비용을 실제 원가에 포함하지
않는다. 다만 실행 전 예약 budget에는 최악 경로 또는 확률 가중 예상 경로를
사용할 수 있다.

## 10. 원가 ledger 필수 필드

```text
agent_run_id
workspace_id
request_tier
route
billable_outcome
run_status

provider
model
pricing_snapshot_id
uncached_input_tokens
cached_input_tokens
billable_output_tokens
model_call_count

tool_name
tool_call_count
search_credits
crawled_pages
new_embedding_tokens

retry_count
handoff_count
agent_execution_seconds
crawler_execution_seconds

estimated_cost
actual_cost
currency
fx_snapshot_id
```

Agent가 비용 계산 Tool을 선택하게 하지 않는다. 모든 model·Tool adapter가
중앙 Budget Guard와 cost ledger를 통과하도록 실행 계층에서 강제한다.

## 11. Budget Guard 적용

실행 전:

```text
estimated_route_cost <= run_cost_budget
```

실행 중:

```text
reserved_cost
+ actual_model_cost
+ actual_tool_cost
+ pending_parallel_reservation
<= run_cost_budget
```

병렬 Department는 각 부문의 예약 비용을 원자적으로 합산한다. 한 부문이
budget을 모두 선점해 다른 부문이 이미 시작된 뒤 중단되는 race condition을
방지해야 한다.

한도 초과 시 동작:

```text
자동으로 저가 모델로 silent fallback하지 않음
→ 추가 budget 승인 요청
또는
→ PARTIAL_RESULT / HUMAN_REQUIRED로 안전하게 종료
```

## 12. 초기 운영 권장 집계

데이터가 적은 첫 10~20건은 route별 평균 하나만 신뢰하지 않는다.

```text
route별 실행 수
평균·중앙값·p90 run 비용
성공률
평균 model call 수
평균 Tool call 수
retry 발생률
성공 산출물당 변동비
사용자 수정량
```

최소 표본이 쌓이기 전에는 p90 비용을 run budget과 quota 설계의 기본값으로
사용하고, 평균 비용은 손익 추정용으로 병행한다.
