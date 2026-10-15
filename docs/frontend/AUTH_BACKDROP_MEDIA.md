# 로그인 배경 미디어

`AuthBackdrop`이 영상 재생 상태를, `login-media.ts`가 같은 출처의 영상과 포스터 경로를 관리한다. 현재 MP4에는 네 프레임의 화면 전환이 포함돼 디코더 하나로 반복 재생한다. 카메라가 시작 위치로 돌아오는 움직임은 보이므로 완전히 매끄러운 반복 영상이라고 설명하지 않는다.

## 연결과 자산

`frontend/features/workspace/auth/auth-backdrop.tsx`의 컴포넌트를 사용하며 정적인 장식 화면을 children으로 전달한다.

| 속성                        | 용도                                                                        |
| --------------------------- | --------------------------------------------------------------------------- |
| `sources`                   | 우선순위 순서의 사이트 루트 상대 경로. MIME은 `video/mp4` 또는 `video/webm` |
| `poster`                    | 로딩·화면 밖 자동 정지 때 사용하는 첫 프레임                                |
| `staticPoster`              | 사용자 정지·동작 줄이기·데이터 절약·오류 때 사용하는 정지 이미지            |
| `pauseLabel`, `resumeLabel` | 접근성 이름과 툴팁의 번역 문구                                              |

실제 경로는 [미디어 설정](../../frontend/features/workspace/auth/login-media.ts), 파일 출처·해시·용량은 [미디어 자료](../../frontend/public/login/README.md)를 확인한다. 현재 영상은 1280×720, 24fps, 무음이다. 교체 전에는 형식·디코딩·반복 경계·첫 프레임·용량을 실제 파일로 검사한다.

## 상태와 접근성

서버 렌더링, 동작 줄이기, Save-Data 환경에서는 영상 소스를 연결하지 않는다. 처음부터 숨겨졌거나 화면 밖이면 로딩을 늦춘다. 사용자 정지와 화면 비활성·화면 밖 자동 정지는 구분하며, 자동 정지가 사용자의 선택을 바꾸지 않는다. 재생 거부는 사용자의 재시도를 제공하고 디코딩 오류는 반복 재시도하지 않는다.

수동 정지는 기존 승인 정지 이미지를, 재생은 영상을 표시한다. 원래 정지 이미지와 첫 프레임 포스터를 대체 화면으로 유지한다. 소스 변경·컴포넌트 해제 시 이벤트·관측자·로딩·늦은 재생 응답을 정리한다.

`auth-cinematic.css`는 정지 화면 → 포스터 → 영상 순서로 쌓는다. 영상은 실제 재생 전까지 `hidden`을 유지하고 CSS로 이를 덮어쓰지 않는다. 44px 재생 버튼은 키보드로 접근할 수 있어야 하며 상위 요소에 `aria-hidden`이나 `pointer-events: none`을 적용하지 않는다. `data-media-state`는 `absent`, `disabled`, `loading`, `playing`, `paused`, `blocked`, `error`를 사용한다.

## 검증

`frontend`에서 Node.js 22로 실행한다.

```sh
node --test --test-concurrency=1 tests/auth-media-policy.test.mjs
```

이 검사는 소스 제한·정책·재생 수명·실패·정리를 확인한다. 실제 디코딩·반복·모바일 제어·화면 밖 정지는 `tests/browser/auth-cinematic.spec.mjs`가 확인한다. 두 검사는 로컬 자산과 합성 데이터를 사용하며 실제 계정이나 생성 서비스는 호출하지 않는다. 영상 제작 당시 측정값은 [로그인 검증 이력](../testing/login-ui-2026-10-05.md)에 남긴다.
