# 검색·답변 가능성 실험

문서 검색, 로컬 판별기, LLM 근거 검증을 단계별로 비교한다. 운영 검색기는 `agent/src/retrieval`에 있으며, 이 폴더의 합성 예제와 KLUE 결과는 운영 성능을 보장하지 않는다.

## 코드 구성

| 파일                      | 책임                                        |
| ------------------------- | ------------------------------------------- |
| `similarity_types.py`     | 청크·질문·군집·판별기 데이터 구조           |
| `text_chunks.py`          | 텍스트·PDF 읽기, 청크 분할과 중복 제거      |
| `embeddings.py`           | 해시 기반 모의 임베딩, OpenAI 임베딩과 캐시 |
| `similarity_index.py`     | 군집화, BM25 검색, 유사도 특성 추출         |
| `similarity_metrics.py`   | 판별기 학습, 검증 임계값과 평가 지표        |
| `similarity_plots.py`     | 결과 시각화                                 |
| `similarity_benchmark.py` | 비교 실행과 기존 import 진입점              |

`similarity_demo_fixture.py`의 `llm_accept`는 경로 검사에 쓰는 모의 판정이다. 해시 임베딩과 함께 실제 모델 품질·유료 API 성공 근거로 해석하지 않는다. 실제 평가 표본의 출처·분할·해시는 [데이터 안내](data/README.md)에 있다.

저장소 루트에서는 `experiments.retrieval_benchmark.similarity_benchmark`로 불러올 수 있다. 기존 스크립트의 `from similarity_benchmark import ...` 방식도 유지한다.

## 실행과 의존성

저장소 루트에서 실행한다.

```powershell
uv sync --project experiments/retrieval_benchmark --group dev
uv run --project experiments/retrieval_benchmark pytest experiments/retrieval_benchmark

# Hugging Face 데이터 준비와 로컬 교차 인코더·QA 판독기 실행
uv sync --project experiments/retrieval_benchmark --group dev --extra local-models

# PDF를 직접 읽는 실험에만 추가
uv sync --project experiments/retrieval_benchmark --group dev --extra pdf
```

로컬 모델 실행에는 별도 가중치가 필요하다. 보관된 모델 파일이 없으면 고정 결과를 읽을 수는 있어도 동일 평가를 바로 재실행할 수는 없다. 데이터·모델 다운로드와 OpenAI 임베딩·검증 호출은 단위 테스트에 포함하지 않는다.

각 `run_*` 스크립트의 실행 조건과 고정 테스트 결과는 [파이프라인 결과](PIPELINE_RESULTS.md)를 따른다. `run_klue_mrc_benchmark.py`는 검색 기준선, `run_answerability_verifier.py`·`run_full_klue_verifier.py`는 로컬 판별, `run_hybrid_pipeline_benchmark.py`는 결합 경로, `run_local_ensemble_benchmark.py`·`run_qa_reader_benchmark.py`는 판독기 비교, `run_llm_answerability_benchmark.py`는 유료 근거 검증을 담당한다.

결과는 Git에서 제외한 `output/`에 저장한다. 유료 실행 전에는 스크립트의 확인 인자와 가격 스냅샷, 입력 표본 수를 확인한다. 과거 실행 수치와 이번 코드 정리의 단위 검사 결과는 구분한다.
