# 고정 후보 OCR 재현 자료

2026-10-07 실험의 실행기·사전 기준·계획·잠금 파일을 보존한다. 원본 입력·모델 바이너리·자격 증명·비공개 정책은 Git에 없다. 실행 전 [판정 보고서](../ocr-rapidocr-feasibility-2026-10-07.md)와 대상 환경을 확인한다.

[교체 기준](evaluation-gates.json)과 [실험 입력 계획](feasibility-plan.json)은 후보 출력을 보기 전에 고정한 조건이다. 실행 한도는 driver·worker에 대응한다. 원본 측정 자료의 해시와 재현성을 위해 파일 내용은 유지한다.

이 Dockerfile은 기록된 해시 잠금 파일을 직접 설치하는 재현용 변형이다. 당시 원본 이미지는 빌드 중 `uv pip compile --generate-hashes`로 잠금을 만들고 `uv pip install --require-hashes --no-deps`로 설치한 뒤 manifest를 기록했다. 이 변형·모델 다운로드 도구는 정적으로 검토했으며 자원 기준 실패 뒤 새 평가로 실행하지 않았다. 나중에 OS·기본 이미지 계층을 다시 받으면 당시 이미지와 달라질 수 있으므로 빌드·inspect 기록을 함께 남긴다.

## 재현 순서

1. 소스 `aa1fa8bc1707d7c8763d7ac8dd153f6eb79cfc34` 또는 보고서 커밋 `2e487d253db1a4efd7fe6bdd3fefd40d8b5d9e2f`의 격리된 작업 폴더에서 원래 Agent 이미지를 `codex-ocr-coverage-candidate-20261007`로 빌드한다. 평가 때 일반 DB 마이그레이션 진입점은 실행하지 않으며 이 디렉터리의 이미지가 이를 대체한다.
2. 이 디렉터리에서 `python fetch_models.py`를 실행해 공식 공개 모델을 받고 SHA-256을 검증한다. 표준 라이브러리만 사용하며 `models/`에 쓴다. 이 도구는 공개 후보 모델용이며 원본 입력을 내려받지 않는다.
3. `feasibility-plan.json`과 계획에 적힌 합성 PNG 세 개를 별도 `probe-inputs` 폴더에 준비하고 해시를 확인한다. 과거 세 문구를 이용한 자원 선별 검사이며 독립적인 새 품질 평가셋이 아니다.
4. 아래 이미지 빌드를 실행한다. 허용한 모델·실행기·잠금 파일만 빌드 맥락에 포함한다.
5. 새 빈 결과 폴더를 만들어 제한된 컨테이너를 한 개 실행한다. driver에는 당시 UTC 07:00/KST 16:00 종료 조건이 있으므로 다른 세션에서 재현하려면 허용된 작업 복사본에서 시간을 조정하고 그 차이를 기록한다. 정상 종료 코드만 보지 말고 CSV와 `gates_passed`를 확인한다.

```sh
docker buildx build --resource memory=1g --resource cpu-period=100000 --resource cpu-quota=100000 --load -t codex-ocr-rapidocr-feasibility-20261007 .
```

```powershell
docker run --rm --cpus 1 --memory 640m --pids-limit 256 --read-only --tmpfs /tmp:size=256m,noexec,nosuid --security-opt no-new-privileges:true --network none --mount "type=bind,source=<absolute-probe-inputs>,target=/probe-inputs,readonly" --mount "type=bind,source=<absolute-empty-output>,target=/results" codex-ocr-rapidocr-feasibility-20261007
```

## 측정 범위

driver는 작업자별 프로세스 그룹을 만들고 `/proc`를 20ms마다 읽는다. 기존 Agent 네이티브 실행기와 AS512MiB·CPU12s·FSIZE0·명령3s·공유8s·외부15s 제한을 사용하며 한 입력이 세 번 실패하면 확장을 멈춘다. 초기 import·모델 준비 비용도 기록한다.

부모 관측치와 cgroup 값은 측정 범위가 다르다. RSS 합계는 공유 페이지를 중복 계산할 수 있어 컨테이너 메모리 사용량이 아니다. 자원 기준 실패 뒤 전체 후보 API 통합이나 품질 비교는 시도하지 않았다.
