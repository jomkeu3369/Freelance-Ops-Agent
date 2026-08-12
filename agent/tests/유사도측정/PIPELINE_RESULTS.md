# Retrieval answerability pipeline 결과

## 채택 구조

```text
Dense + BM25 RRF retrieval
  → Top-5 local cross-encoder
  → 확실한 구간만 local accept/reject
  → 나머지는 LLM evidence verifier
  → 근거 제한 답변 생성
```

클러스터 중심 유사도는 answerability gate에서 제외한다. 클러스터는 corpus 분석과 검색 결과
다양화에만 사용할 수 있다.

## Frozen-test 결과

KLUE-MRC test 200건(answerable 100, unanswerable 100)을 사용했다.

| 구성 | Retrieval | Local coverage | Fallback | FAR | FRR | Local accept precision |
|---|---:|---:|---:|---:|---:|---:|
| Top-3 hybrid + cross-encoder | Recall@3 0.82 | 0.195 | 0.805 | 0.04 | 0.07 | 0.733 |
| Top-5 hybrid + cross-encoder | Recall@5 0.87 | 0.170 | 0.830 | 0.04 | 0.03 | 0.750 |
| Top-10 hybrid + cross-encoder | Recall@10 0.91 | 0.165 | 0.835 | 0.03 | 0.04 | 0.800 |
| Top-5 cross-encoder + QA reader 교집합 | Recall@5 0.87 | 0.030 | 0.970 | 0.00 | 0.01 | 1.000 |

FAR/FRR threshold는 validation 150건에서 90% Wilson upper bound가 각각 0.10 이하가 되도록
선택했다. Frozen test는 threshold 선택에 사용하지 않았다.

## 결론

- Dense+BM25 RRF는 기존 dense Recall@3 `0.72`를 hybrid Recall@3 `0.82`로 개선했다.
- 일반 KLUE local verifier 하나는 LLM 호출을 약 17% 줄일 수 있지만 자동 허용 precision `0.75`라
  최종 답변 허용 gate로는 안전하지 않다.
- 두 local model이 동의하는 경우만 처리하면 자동 허용 precision은 `1.0`이지만 처리율이 `3%`로
  내려가 LLM 비용 절감 효과가 거의 없다.
- 현재 모델은 검색 reranking과 보조 신호로 사용하고, 답변 허용은 LLM evidence verifier가 담당한다.
- 실제 계약서·견적서·요구사항의 사람 label을 축적한 뒤 local verifier를 재학습한다. 별도 frozen
  domain test에서 accept precision과 recall을 동시에 만족할 때만 local accept 범위를 확대한다.

Top-5 cross-encoder 기준 frozen test 166건의 LLM fallback 예상 비용은 `gpt-5.4-nano` 단가와
문자 수 기반 token 추정으로 약 `$0.026`이다. Ensemble은 194건, 약 `$0.030`이다. 실제 비용은
provider usage token으로 다시 집계해야 한다.

## 실행

```powershell
cd agent
$env:HF_HOME="$PWD\.uv-cache\huggingface"
$env:HF_HUB_OFFLINE="1"

& ..\experiments\classification_benchmark\.venv\Scripts\python.exe `
  tests\유사도측정\run_hybrid_pipeline_benchmark.py `
  --dataset tests\유사도측정\data\klue_mrc_answerability_650.jsonl `
  --model-dir .uv-cache\similarity-benchmark\klue-full-verifier `
  --output-dir tests\유사도측정\output\hybrid-pipeline `
  --candidate-k 5
```
