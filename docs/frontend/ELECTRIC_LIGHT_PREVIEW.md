# 소개 화면 광선 비교와 복구

히어로의 넓게 휘는 광선과 포인터 반응을 확인하는 안내다. 가는 필라멘트·넓은 빛·곡선을 따라 흐르는 밝기는 [제공된 참고 영상](https://www.instagram.com/reel/Dd9nhiOyrZU/)의 시각적 참고점이다. 포인터의 국소 반발과 감쇠 복귀는 이 프로젝트의 구현이며 원본 영상의 입력 방식까지 확인한 것은 아니다.

## 비교

- `/`: 보라·파란 깊이, 이동하는 밝기와 국소 포인터 반응을 사용하는 렌더러.
- `/?hero-light=classic`: 같은 페이지에서 이전 광선 렌더러 비교.
- 모바일·동작 줄이기에서는 정적인 프레임을 표시한다. 화면 밖·숨긴 탭에서는 렌더링을 중단하며 WebGL 실패 시 기존 SVG로 복구한다.
- 하단은 기존 렌더러를 사용한다. 포인터 효과는 배치나 클릭 영역을 바꾸지 않는다.

구현은 `frontend/features/home/components/webgl-scene.tsx`와 `frontend/features/home/webgl`에서 확인한다. 실제 재생·정지와 화면별 제어는 코드와 [소개 화면 안내](../../frontend/features/home/README.md)를 우선한다.

## 복구

비교 기준은 [PR #56](https://github.com/jomkeu3369/Freelance-Ops-Agent/pull/56)의 `a3b7719af6af4b7969b02bbc05d14459f2c8ab26`이다. `classic` 주소는 시각 비교용이며 운영 배포를 되돌리지 않는다. 배포를 철회하려면 대상 광선 변경만 되돌리는 PR을 만들고 정상 CI·배포 절차를 따른다. 독립적인 업무 화면 변경과 데이터는 보존한다.

## 검증

`frontend/tests/browser/electric-light.spec.mjs`는 실제 픽셀 변화·국소 포인터 반응·정적 표시·비교 주소·화면 밖 정지를 검사한다. GPU 픽셀 비교는 실행 환경의 영향을 받으며 테스트 파일이 있다는 사실만으로 최신 실행 통과를 주장하지 않는다. 검증 커밋과 CI 결과를 함께 확인한다.
