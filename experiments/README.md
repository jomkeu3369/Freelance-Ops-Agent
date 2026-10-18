# 실험 안내

운영 코드와 분리해 모델과 실행 정책을 비교한다. 과거 결과, 재현 실행, 단위 검사를 구분해 읽는다. 이 폴더의 결과만으로 운영 성능이나 정책 승격을 확정하지 않는다.

| 실험                       | 코드·실행 안내                                                 | 보관된 근거                                                                                                            |
| -------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 요구사항 분류 모델 비교    | [classification_benchmark](classification_benchmark/README.md) | [평가 수치·환경·비용](classification_benchmark/RESULTS.md)                                                             |
| 실행 경로 선택과 검토 정책 | [routing_benchmark](routing_benchmark/README.md)               | [결과 해석](routing_benchmark/RESULTS.md), 날짜별 `reports/`의 JSON·CSV·차트                                           |
| 검색과 답변 가능성         | [retrieval_benchmark](retrieval_benchmark/README.md)           | [고정 테스트 결과](retrieval_benchmark/PIPELINE_RESULTS.md), [KLUE 표본 출처·해시](retrieval_benchmark/data/README.md) |
| 실행 시간 예측과 스케줄링  | [runtime_scheduler](runtime_scheduler/README.md)               | 고정 시드 합성 데이터, 정책별 시뮬레이션·차트 생성 코드와 README 수치                                                  |

## 결과를 읽는 기준

- 분류·라우팅 실험의 모델명, 가격표와 측정 환경은 당시 조건이다. 현재 운영 모델·가격의 근거로 사용하지 않는다.
- 라우팅의 `reports/latest`와 `reports/run-001`도 서로 다른 과거 실행 기록이다. 이름만으로 최신 실행이나 중복 파일로 판단하지 않는다. 새 평가에는 별도 출력 폴더를 지정한다.
- 데이터 분할, 고정 시드, 원본 ID·해시, 성공·실패·미실행 범위는 결과와 함께 보존한다. LLM 평가 점수는 기준 레이블에 대한 정량 평가를 보완한다.
- 분류의 원본 `reports/`, 검색 모델 가중치·로컬 출력, 스케줄러의 생성 이미지·모델 파일은 Git에 포함하지 않는다. 요약 수치만 있는 기록은 원본 산출물이 공개돼 있다고 해석하지 않는다.
- 합성 요청·모의 판정·오프라인 정책 비교는 실제 고객 요청이나 운영 장애 복구의 검증 결과가 아니다. 운영 적용 여부는 [현재 구현 안내](../docs/README.md)와 각 서비스 코드를 따른다.

## 재현과 단위 검사

Python 3.12에서 각 폴더의 `pyproject.toml`을 기준으로 독립 환경을 사용한다. 라우팅 실험은 함께 보관한 `uv.lock`도 사용한다. 나머지 실험은 의존성 범위를 지정하므로 재현 결과에 실제 설치 버전을 기록한다.

```powershell
# 저장소 루트에서 실행. 유료 실험·데이터 다운로드와 구분한 단위 검사다.
uv run --project experiments/classification_benchmark --extra dev pytest experiments/classification_benchmark/tests
uv run --project experiments/routing_benchmark --extra dev pytest experiments/routing_benchmark/tests
uv run --project experiments/retrieval_benchmark --group dev pytest experiments/retrieval_benchmark
uv run --project experiments/runtime_scheduler --group dev pytest experiments/runtime_scheduler
```

실행 시간 예측 검사는 소규모 로컬 모델 학습을 포함한다. 유료 API 호출, 전체 모델 학습, 데이터·가중치 다운로드는 각 실험의 별도 실행 절차를 따른다. 유료 실행 전에는 확인 인자, 평가 건수, 모델과 가격 스냅샷을 확인하고 실제 사용 토큰과 비용을 기록한다.

API 키·환경 파일·고객 데이터와 로컬 생성물은 커밋하지 않는다. `local_archive/`는 Git에서 제외한 개인 재현 자료 보관 경로다. 포트폴리오에서 인용하는 고정 결과는 실행 시점과 데이터 조건을 함께 연결한다.
