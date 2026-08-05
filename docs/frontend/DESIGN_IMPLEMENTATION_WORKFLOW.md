# Frontend 디자인·구현 협업 절차

## 목적

Freelance Ops Agent V2의 frontend는 Codex가 시각 디자인을 임의로 완성하는 방식으로 진행하지 않는다. 현업 웹디자이너가 1920×1080 기준의 시안을 설계하고, Codex는 제품 문서와 디자인 결과물을 연결해 Next.js·React·TypeScript 코드와 반응형 화면으로 구현한다.

현재 `frontend/`에 있는 화면은 제품 구조, 테마, 모션과 빌드 방식을 검증한 prototype이다. 최종 시각 디자인의 기준이나 웹디자이너의 handoff를 제한하는 source of truth로 사용하지 않는다.

## 역할

### 사용자

- 참고할 실제 사이트 2~3개를 선택한다.
- 각 사이트에서 참고할 화면·구성·타이포그래피·상호작용과 제외할 요소를 설명한다.
- 웹디자이너의 1920×1080 결과물을 검수하고 최종 시각 방향을 승인한다.
- Vercel Preview를 검수한 뒤 Production 배포를 승인한다.

### Codex

- 레퍼런스를 복제하지 않고 정보 구조, 레이아웃 원칙, 타이포그래피, 상호작용과 상태 표현으로 분해한다.
- `docs/V2_SPECIFICATION.md`와 관련 문서를 근거로 실제 화면 문구와 제품 규칙을 정리한다.
- 웹디자이너에게 전달할 brief, content matrix, screen specification, component inventory, interaction guide와 handoff checklist를 작성한다.
- 디자이너가 제공한 HTML·CSS·JavaScript를 Next.js·React·TypeScript component로 변환한다.
- 1920×1080 원본의 시각적 의도를 보존하면서 desktop, tablet과 mobile 반응형 동작을 추가한다.
- 접근성, loading/error/empty state, keyboard interaction, API contract와 test를 구현한다.
- Vercel Preview를 배포하고 승인된 revision만 Production에 배포한다.

### 웹디자이너

- 승인된 brief와 제품 문구를 기준으로 1920×1080 화면을 제작한다.
- 가능한 경우 HTML·CSS·JavaScript와 함께 이미지, 아이콘, 폰트, 라이선스와 interaction 설명을 전달한다.
- light/dark theme가 모두 필요한 화면은 두 상태를 제공한다.
- hover, focus, selected, disabled, loading, error와 empty 등 필요한 상태를 명시한다.

## 단계별 절차

### 1. 레퍼런스 선정

사용자가 레퍼런스 2~3개의 URL 또는 캡처를 제공한다. 각 레퍼런스에는 다음 내용을 함께 기록한다.

- 참고할 page 또는 section
- 마음에 드는 요소와 그 이유
- 사용하지 않을 요소
- light/dark theme 방향
- 필요한 animation과 interaction

### 2. 디자이너 전달자료 작성

Codex는 다음 문서를 `docs/frontend/`에 준비한다.

```text
DESIGN_BRIEF.md
CONTENT_MATRIX.md
SCREEN_SPECIFICATION.md
COMPONENT_INVENTORY.md
INTERACTION_GUIDE.md
DESIGN_HANDOFF_CHECKLIST.md
```

문서에는 서비스와 사용자 설명, page별 목적, 실제 문구, navigation과 정보 구조, realistic data, component와 state, 접근성 요구사항, 디자이너의 재량 범위와 반드시 지켜야 하는 제품 규칙을 포함한다.

### 3. 1920×1080 디자인 handoff

기본 handoff package는 다음을 포함한다.

- 완성된 HTML, CSS와 JavaScript
- 1920×1080 기준 화면
- image, icon과 font 원본
- light/dark theme
- 주요 interaction 설명
- 외부 library와 asset license

Figma 또는 raster 시안만 전달되는 경우에도 구현할 수 있지만, 정적 코드가 함께 제공되는 경우 이를 시각적 의도의 우선 기준으로 사용한다.

### 4. React와 반응형 구현

- 기술 기준은 Next.js, React와 TypeScript다.
- 반복되는 UI를 component로 분리하되, 분리 때문에 원본의 DOM·CSS 의도가 훼손되지 않게 한다.
- static mock data는 typed fixture로 분리하고 이후 Spring 공개 API contract로 교체할 수 있게 한다.
- browser는 Spring Boot 공개 API만 호출하며 Python Agent service를 직접 호출하지 않는다.
- 1920px은 디자이너 원본 검수 기준으로 유지한다.
- 1440px desktop, 1024px small laptop/tablet landscape, 768px tablet portrait, 약 390px mobile에서 정보 우선순위와 interaction을 재배치한다.
- 단순 축소보다 navigation, grid, table, editor, drawer와 modal의 사용성을 우선한다.
- 디자인 해석이 필요한 변경은 임의로 확정하지 않고 차이와 trade-off를 사용자에게 제시한다.

### 5. 검수와 Vercel 배포

다음 gate를 통과한 뒤 배포한다.

- 1920×1080 원본과 visual comparison
- 1440, 1024, 768과 mobile responsive 확인
- light/dark theme와 긴 한글 문구 확인
- hover, focus, keyboard, loading, error, empty와 disabled 상태 확인
- TypeScript, lint, component test와 production build 통과
- image와 font 최적화, 기본 accessibility와 performance 확인
- Vercel Preview 사용자 승인
- 승인된 commit의 Vercel Production 배포

Vercel은 frontend를 배포한다. Spring Boot, Agent service와 PostgreSQL의 배포 경계 및 browser가 Spring 공개 API만 호출하는 원칙은 그대로 유지한다.

## 완료 기준

- 웹디자이너의 1920×1080 결과와 구현 화면의 핵심 layout, typography, color와 spacing이 합의된 허용 오차 안에서 일치한다.
- 반응형 화면에서 핵심 업무를 가로 스크롤이나 잘린 control 없이 완료할 수 있다.
- 시각 상태와 backend 상태가 혼동되지 않고 AI 초안과 사용자 확정 결과가 구분된다.
- Vercel Preview에서 검수한 동일 revision이 Production에 배포된다.
