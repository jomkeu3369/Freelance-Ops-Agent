# Baseline results

## 2026-08-10 GPU full run

- Dataset: `limsc/fr-nfr-classification` (669 train / 143 validation / 144 test)
- Hardware: NVIDIA GeForce RTX 5060 Ti 16 GB
- Runtime: PyTorch 2.13.0+cu132, CUDA 13.2, BF16
- Training: 3 epochs, batch 16, max length 256, seed 42

| Metric | A: DistilBERT | B: MiniLM |
|---|---:|---:|
| Accuracy | 0.8264 | 0.8264 |
| Macro-F1 | 0.8168 | 0.8210 |
| Training time | 9.45 s | 13.08 s |
| Inference p50 | 11.22 ms | 21.59 ms |
| Inference p95 | 23.53 ms | 34.19 ms |
| Parameter memory | 255.4 MB | 127.3 MB |
| Peak CUDA memory | 1763.5 MB | 1333.1 MB |

Paired exact McNemar 결과는 A만 정답 10건, B만 정답 10건, `p=1.0`이다. B-A
macro-F1 bootstrap delta 중앙값은 0.0033이고 95% CI는 `[-0.0609, 0.0672]`이다.
따라서 이번 run에서 분류 품질의 유의한 승자는 없다.

- latency가 우선이면 A가 유리하다.
- 모델 크기와 peak VRAM이 우선이면 B가 유리하다.
- 최종 선택 전에는 seed 반복 실행과 도메인 내부 한국어 요구사항 benchmark가 필요하다.

원본 row별 prediction과 latency는 gitignored local report
`reports/gpu-full/local_ab.json`에 저장된다.

## Three-model LLM-as-a-Judge paired evaluation

동일한 test ID 30건에 대해 각 분류기의 결과를 `gpt-5.6-sol`, `gpt-5.6-terra`,
`gpt-5.6-luna`가 독립 평가했다. 다수결 pass와 score 중앙값을 사용했다.

| Metric | A: DistilBERT | B: MiniLM |
|---|---:|---:|
| Classification pass | 0.7667 | 0.8667 |
| Groundedness | 0.8750 | 0.9167 |
| Groundlessness | 0.1250 | 0.0833 |
| Hallucination | 0.0000 | 0.0333 |

Judge pass는 30건에서 실제 label 정답 여부와 100% 일치했다. B만 pass 4건, A만 pass
1건이지만 paired exact McNemar `p=0.375`이므로 10%p 차이를 유의한 우위로 확정할 수
없다. Judge 3개의 verdict는 80% sample에서 완전히 일치했다.

| Judge | 60-call cost | Mean latency |
|---|---:|---:|
| gpt-5.6-sol | USD 0.325070 | 3.889 s |
| gpt-5.6-terra | USD 0.100712 | 2.173 s |
| gpt-5.6-luna | USD 0.014434 | 2.383 s |

paired report가 포함하는 실제 verdict 비용은 USD 0.440216이다. 최초 unpaired 탐색 run과
paired 보정 호출을 포함한 총 발생 비용은 USD 0.614060이다. 보정 실행은 기존 117 calls를
재사용하고 63 calls만 새로 호출했다. LangSmith project
`freelance-ops-classification-benchmark`에서 성공한 chain 및 LLM trace를 확인했다.

Matplotlib 그래프는 `reports/gpu-full-paired/plots/classifier-ab.png`와
`reports/gpu-full-paired/plots/llm-judge-ab.png`에 저장된다.
