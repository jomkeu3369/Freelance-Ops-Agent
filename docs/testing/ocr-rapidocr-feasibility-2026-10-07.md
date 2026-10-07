# RapidOCR 후보 자원 평가 — 교체 gate 미통과

2026-10-07 14:14 KST에 첫 합성 한글 입력을 새 worker/native 프로세스로 3회 순차 실행했다. **3회 모두 OCR 전처리에서 `MemoryError`가 발생하여 이번 고정 후보 설정은 no-go다.** 기존 worker 주소 공간 512MiB를 유지했고 추가 언어·독립 60개 품질 평가와 엔진 교체 구현은 진행하지 않았다. 현재 Tesseract 기반 구조 수정 및 검증 결과는 [검증 보고서](ocr-coverage-validation-2026-10-07.md)에 있다.

## 사전에 고정한 후보와 조건

공식 PyPI `rapidocr==3.9.2`, `onnxruntime==1.30.0`; 공식 RapidOCR v3.9.2 manifest의 ONNX PP-OCRv5 mobile detection, mobile text-line classification, Korean mobile recognition을 사용했다. 인식 모델은 한국어·영어·숫자 지원 모델이다. RapidOCR 최신 기본 PP-OCRv6를 그대로 사용하지 않고 세 모델의 버전·언어·로컬 경로를 명시했다. 모델 파일 크기는 실행 RAM 요구량이 아니다. [RapidOCR 모델 문서](https://rapidai.github.io/RapidOCRDocs/main/model_list/), [PaddleOCR 인식 모델 문서](https://github.com/PaddlePaddle/PaddleOCR/blob/main/docs/version3.x/module_usage/text_recognition.en.md), [RapidOCR PyPI](https://pypi.org/project/rapidocr/), [ONNX Runtime PyPI](https://pypi.org/project/onnxruntime/).

| 역할 | 고정 ONNX 파일 | bytes | 공식 SHA256 |
| --- | --- | ---: | --- |
| detection | ch_PP-OCRv5_det_mobile.onnx | 4,819,576 | 4d97c44a20d30a81aad087d6a396b08f786c4635742afc391f6621f5c6ae78ae |
| classification | ch_PP-LCNet_x0_25_textline_ori_cls_mobile.onnx | 1,018,508 | 54379ae5174d026780215fc748a7f31910dee36818e63d49e17dc598ecc82df7 |
| Korean recognition | korean_PP-OCRv5_rec_mobile.onnx | 13,488,748 | cd6e2ea50f6943ca7271eb8c56a877a5a90720b7047fe9c41a2e541a25773c9b |

다운로드 URL은 `https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.2/onnx/PP-OCRv5/{det,cls,rec}/...`이며 로컬 파일 SHA256이 공식 wheel manifest와 일치했다. 인식 사전은 ONNX 내부 metadata를 사용한다. runtime network none 상태에서 세 session이 모두 `CPUExecutionProvider`로 초기화됐다. GPU·외부 API·사용자 문서 전송은 없다. RapidOCR/PaddleOCR 프로젝트는 Apache-2.0, ONNX Runtime 프로젝트는 MIT로 표시된다. [RapidOCR license](https://github.com/RapidAI/RapidOCR/blob/main/LICENSE), [PaddleOCR license](https://github.com/PaddlePaddle/PaddleOCR/blob/main/LICENSE), [ONNX Runtime license](https://github.com/microsoft/onnxruntime/blob/main/LICENSE).

평가 이미지는 수정 Agent 이미지에서 파생한 별도 이미지다. 운영 이미지와 다른 의존성은 `opencv-python==5.0.0.93`, `omegaconf==2.3.1`, `protobuf==7.36.2`, `pyclipper==1.4.0`, `shapely==2.1.2` 등을 포함한다. standard OpenCV wheel의 로컬 라이브러리 로딩을 위해 이미지에 libgl1/libglib2.0-0을 추가했다. 기존 numpy 2.5.2/Pillow 12.3.0은 constraint로 유지했다. host에 설치하거나 기존 프로젝트 lock을 수정하지 않았다. headless OpenCV 변형, 구버전 의존성, 낮춘 detection 해상도는 이번 평가에 포함하지 않았다.

Docker image ID/index digest `sha256:31abac5c2eff4c3692502d40026b035dc54a5b2ac4e12745f1e3b4d4ebd452d9`; 기반 Agent image `sha256:fafca6c97c481102b01ea2197eb85b64e28bf5e66b49fead9ad57bc1f2505e7d`. 실제 패키지 버전과 hash가 있는 dependency lock SHA256 `6b965f1719c7babc1b21ef72852c47a2fe16036bde88273d153b4b18cb576c48`; installed manifest SHA256 `d8af8b786d0a54727ba869c02f1cfad9c556d3c763121a25e776ee81f9855228`.

공식 PyPI wheel hash: `rapidocr-3.9.2-py3-none-any.whl` SHA256 `04d6b8d151f823d930bd91910555f57bea897c0c44fa6794267b94cf9c1ef9a0`(별도 다운로드 검증 완료); 이 Python3.12/Linux x86_64의 호환 `onnxruntime-1.30.0-cp312-cp312-manylinux_2_28_x86_64.whl` 공식 SHA256 `fa688e7891a6aa206636fe7372e27ee75fd17713289f6b4fc7b190e0a7de9328`. hash-required lock으로 이미지를 설치했고 내부 manifest에서 실제 런타임 버전을 확인했다.

Container CPU1/memory640MiB/pids256/root read-only/tmp256MiB noexec nosuid/network none/UID10001; worker 및 native의 AS512MiB/CPU12초/FSIZE0을 유지했다. **변경하지 않은 운영 `attachments.ocr.run_native`**의 bounded stdin/stdout, 3초 command deadline 및 8초 shared deadline을 사용했다. outer worker는 15초에서 자체 process group만 종료하도록 했다. numerical libraries/OpenCV/ORT intra/inter threads는 1, recognition/classification batch는 1, CPU arena는 false로 명시했다. global edge2000 및 나머지 RapidOCR 이미지 전처리·detection 기본값은 유지했다. 새 Python subprocess의 import 및 세 모델 loading을 native 제한 안에서 수행했다.

이 feasibility는 별도 CLI probe다. 실제 API/router에 후보를 연결하거나 제품 코드를 교체하지 않았다. 기존 guard 및 worker 한도를 재사용한 최소 실행에서도 실패하므로 full API 품질 비교로 확장하지 않는다. 성공한 OCR 처리 시간 또는 latency 우위로 이 실패 실행의 시간을 해석하지 않는다. OS cache를 비우지는 않았으므로 cold는 새 프로세스와 매번 새 session loading을 뜻한다.

실행 전 고정한 feasibility plan SHA256 `121c4f2a8738048a76e38e5495e53858941b2a97b3917962b324f4e72786b893`; replacement gates SHA256 `b953b4c954ea48e4dd7ec6d8d1c64d15a3366451f52c56ba41a5ffc9b43e00aa`. 첫 KO, 다음 mixed, 다음 EN 각 3회를 계획했고 첫 입력 gate 실패 시 그 입력의 3회 확인 후 확장을 중단하도록 정했다. 판정 기준과 계획 파일을 결과 후 수정하지 않았다.

## 실측 및 실패

| 반복 | worker 부모 wall | worker wall | native wrapper(import/loading 포함) | import | 모델 init | native peak RSS | 관측 native peak VMS | 결과 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | 1.623초 | 1.591초 | 1.421초 | 1.084초 | 0.167초 | 209.07MiB | 501.09MiB | MemoryError |
| 2 | 1.269초 | 1.243초 | 1.122초 | 0.797초 | 0.163초 | 209.10MiB | 500.87MiB | MemoryError |
| 3 | 1.241초 | 1.217초 | 1.088초 | 0.755초 | 0.177초 | 209.52MiB | 501.31MiB | MemoryError |

native wrapper 중앙값 1.122초, nearest-rank p95(n=3) 1.421초다. 이 시간은 **실패까지**의 시간이다. 모두 `engine(image_bytes)`에서 `Unable to allocate 32.8 MiB for an array with shape (896, 1600, 3) and data type float64`로 종료됐다. 실제 detection/recognition 결과 및 CER/WER는 없다. RSS가 약209MiB여도 공유 라이브러리·mapping 등을 포함한 주소 공간 한도에 닿을 수 있다. 20ms `/proc` 관측 VMS는 peak를 놓칠 수 있어, 한도 적용 및 오류 원문과 함께 해석한다.

실패 위치 확인 요청에 따라 **동일 image/input/model/options/limits에서 1회만 별도 진단**했다. gate의 원래 3회 CSV/계획/판정은 수정하지 않았고 품질 반복 수로 추가하지 않았다. 이 진단도 같은 MemoryError로 실패했으며 native wrapper 2.292초, worker 2.507초였다. stack은 locals나 문서 내용을 제외한 file/line/function만 기록했다. 실제 frame 순서는 `rapidocr/main.py:120 __call__ → :130 run_ocr_steps → :301 detect_and_crop → rapidocr/ch_ppocr_det/main.py:57 __call__ → utils.py:65 __call__ → utils.py:71 normalize`다. line71의 `(img.astype("float32") * self.scale - self.mean) / self.std`에서 float64 결과 배열을 할당하지 못했다. native의 `getrlimit`은 여전히 AS `[536870912,536870912]`, CPU `[12,12]`, FSIZE `[0,0]`이었다. `/opt/feasibility/native_probe.py:43`은 probe가 `engine(image_bytes)`를 호출한 위치다. 원래 native stderr는 guard가 버렸으므로 최초 3회의 전체 stack을 수집했다고 주장하지 않는다.

컨테이너 cgroup memory peak 254,398,464bytes(242.61MiB), `memory.max=671088640`, `cpu.max=100000 100000`, pids256. memory events의 oom/oom_kill/max는 모두 0, Docker State.OOMKilled=false였다. **컨테이너 OOM이 아니라 프로세스 주소 공간 제한 아래의 배열 할당 실패**다. worker와 native 양쪽 `/proc/limits` 및 native `getrlimit`에서 AS536870912/CPU12/FSIZE0을 확인했다. phase별 CPU seconds는 따로 측정하지 않았고 wall과 CPU 한도 적용을 기록했다. native runtime logging stderr는 guard에서 버리며, 이 probe의 오류는 synthetic 입력에 한해 구조화된 stdout으로 보관했다.

입력 SHA256 `178020495b61cd2ed390153b037367b8c17ece4a5b9c267d9fc90e370ec46adc`는 기존 합성 `clean_korean.png`와 같다. 기존 개선 Tesseract의 ko/PSM6 reader 비교는 같은 입력 3회 CER/WER0%를 기록했다. 이는 feasibility 기준 입력의 기존 동작 확인이며 독립적인 엔진 품질 비교가 아니다. 후보의 mixed/EN feasibility는 계획 2개가 미실행됐고, 독립 신규 60개×3회 평가는 **자원 gate 실패로 미실행**이다. 금액·날짜·식별자 정확도, language/layout별 CER, 누락 및 20% 개선 기준은 모두 미평가다.

이번 no-go는 이 버전·의존성·전처리 구성에 한정한다. 모든 RapidOCR/ONNX/Paddle 계열에 대한 판정은 하지 않는다. 메모리·시간 한도를 늘리거나 다른 의존성/해상도 설정으로 판정 기준을 바꾸는 재시도는 하지 않았다. 엔진은 현재 Tesseract를 유지한다.

## 산출물과 재현

[실측 CSV](ocr-rapidocr-feasibility-2026-10-07.csv)에 3회 결과를 저장했다. 작업 폴더의 `rapidocr-feasibility/`에는 Dockerfile, native/worker/driver probes, 고정 plan/gates, model manifest, hash dependency lock, actual installed manifest, build metadata/log, raw JSON, cgroup와 전후 container inspect를 보관한다. 원본 첨부 자료나 인증 메타데이터는 Git 백업에 포함하지 않는다. 이 평가의 실제 agent dependency lock 및 제품 코드는 변경하지 않았다.

공개 가능한 재현 source/사전 plan/gates/공식 hash lock은 [재현 폴더](ocr-rapidocr-repro/README.md)에 백업했다. 별도 failure-location 진단은 task 폴더에 raw JSON과 probe를 보관한다. 모든 후보 평가 컨테이너는 종료 후 해당 작업이 생성한 것만 정리했다. 기존 사용자 프로세스 및 Docker Desktop은 종료하지 않았다.

기존 후보 image와 고정 probe-inputs를 사용해 아래 명령으로 동일 자원 조건을 재현할 수 있다. 새 평가 output 폴더만 만들고 단독으로 실행한다. 기존 image가 없으면 기록한 기반 이미지와 공식 모델·hash lock으로 별도 Dockerfile을 빌드한다. 평가 driver에는 2026-10-07 사용자 PC 사용 마감을 위한 UTC hour cutoff가 있으므로 다른 날짜의 재현에서는 사용자가 승인한 시간으로 명시적으로 조정해야 한다.

```powershell
$candidateRoot = '<this-PC-task-folder>/ocr-evaluation/rapidocr-feasibility'
$output = Join-Path $candidateRoot ('repro-' + (Get-Date -Format 'yyyyMMddHHmmss'))
New-Item -ItemType Directory -Path $output | Out-Null
docker run --rm --cpus 1 --memory 640m --pids-limit 256 --read-only --tmpfs /tmp:size=256m,noexec,nosuid --security-opt no-new-privileges:true --network none --mount "type=bind,source=$candidateRoot/probe-inputs,target=/probe-inputs,readonly" --mount "type=bind,source=$output,target=/results" codex-ocr-rapidocr-feasibility-20261007
```
