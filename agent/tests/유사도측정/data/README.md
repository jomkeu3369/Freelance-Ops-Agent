# KLUE-MRC answerability benchmark sample

`klue_mrc_answerability_650.jsonl`은 Hugging Face의 [`klue/klue`](https://huggingface.co/datasets/klue/klue)
MRC subset에서 재현 가능한 seed `20260812`로 추출한 평가 표본이다.

- 원본 dataset: KLUE-MRC
- 원본 저자: KLUE benchmark contributors
- 원본 license: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)
- subset/config: `mrc`
- 원본 split: `train`, `validation`
- 표본: train 300, validation 150, frozen test 200
- 각 benchmark split의 answerable/unanswerable 비율: 50/50
- context hash를 기준으로 train/validation/test 간 context 중복을 차단한다.
- 원문 전체가 아니라 선택된 650행만 저장한다.
- 표본 SHA-256: `b1c87c62eb594c314190469a6d10e6e9ae77ac43de246ad3fe57b31f650bdfc1`

이 파생 표본도 CC BY-SA 4.0 조건으로 취급한다. 원본 데이터의 뉴스·Wikipedia 문맥은 제품 corpus로
사용하지 않고 오프라인 retrieval/answerability 평가에만 사용한다.

재생성:

```powershell
cd agent
uv run --locked python tests/유사도측정/prepare_klue_mrc_sample.py `
  --output tests/유사도측정/data/klue_mrc_answerability_650.jsonl
```
