# ADR-0010: Designer-first frontend 구현과 Vercel 배포

- 상태: Accepted
- 결정일: 2026-08-05

## Context

구현 담당자가 제품 문서만으로 시각 디자인과 frontend 구현을 동시에 주도하면 사용자가 기대하는 완성도와 현업 웹디자이너의 시각적 판단을 안정적으로 재현하기 어렵다. 현재 `frontend/` prototype은 기술과 interaction 가능성을 검증했지만 최종 디자인 기준으로 확정하지 않았다.

웹디자이너는 1920×1080 기준의 결과물을 제작하고, 가능하면 HTML·CSS·JavaScript와 원본 asset을 함께 제공한다. 구현 담당자는 제품 명세를 디자이너가 사용할 수 있는 자료로 변환하고, 완료된 결과물을 제품 코드와 반응형 화면으로 옮기는 역할에 집중해야 한다.

## Decision

- 사용자가 실제 레퍼런스 사이트 2~3개를 선택한다.
- 구현 담당자는 레퍼런스와 V2 문서를 근거로 웹디자이너용 brief, 문구, 화면 명세, component·state 목록과 handoff checklist를 작성한다.
- 웹디자이너는 1920×1080 기준 화면을 설계하며 HTML·CSS·JavaScript, asset, font와 interaction 설명을 handoff한다.
- 구현 담당자는 handoff를 Next.js·React·TypeScript component로 변환하고 desktop, tablet과 mobile 반응형, 접근성, 상태 처리와 API 연결을 구현한다.
- 1920×1080 결과물은 visual source of truth다. 구현 담당자는 제품 규칙·접근성·반응형 문제를 제외하고 시각 디자인을 임의로 재해석하지 않는다.
- 현재 `frontend/` 화면은 prototype으로만 유지하며 최종 디자인을 구속하지 않는다.
- frontend의 Preview와 Production 배포는 Vercel을 사용한다. Production 배포 전 Vercel Preview에서 사용자의 승인을 받는다.
- browser가 Spring Boot 공개 API만 호출하고 Agent service를 직접 호출하지 않는 기존 서비스 경계는 유지한다.

상세 절차는 [`docs/frontend/DESIGN_IMPLEMENTATION_WORKFLOW.md`](../frontend/DESIGN_IMPLEMENTATION_WORKFLOW.md)를 따른다.

## Consequences

### 장점

- 시각 디자인 책임과 제품 구현 책임이 명확해진다.
- 구현 과정의 임의 디자인 편차를 줄이고 디자이너의 결과를 검수 가능한 기준으로 사용할 수 있다.
- 정적 handoff와 실제 React 구현의 차이를 체계적으로 추적할 수 있다.
- Vercel Preview를 통해 Production 전 이해관계자 검수가 가능하다.

### 비용과 제약

- 구현 전에 레퍼런스 선정과 디자인 제작 시간이 추가된다.
- HTML·CSS·JavaScript가 있더라도 component화, 접근성, 상태 관리와 반응형은 별도 구현이 필요하다.
- 1920×1080 시안만으로 결정할 수 없는 tablet·mobile interaction은 추가 합의가 필요할 수 있다.
- Vercel 환경변수, Spring API origin, CORS, cookie와 인증 설정을 배포 환경별로 관리해야 한다.
