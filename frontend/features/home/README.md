# 메인 소개 화면 수정 안내

주소 `/`의 화면 코드는 이 폴더에 있습니다. `app/page.tsx`는 화면과 기존 스타일을 연결합니다. 구성은 사용자 디자인의 상단 → 문의에서 제안까지의 제품 체험 → 시작 안내 → 하단 메뉴입니다.

| 수정하려는 내용 | 파일 |
|---|---|
| 영역 표시 순서 | `home-page.tsx` |
| 상단 메뉴·모바일 탐색·테마 | `components/home-header.tsx` |
| 히어로·시작 안내·하단 메뉴 | `components/home-sections.tsx` |
| 제품 창·문의/요구사항/리스크/견적/제안 화면·활동 패널 | `components/product-experience.tsx` |
| 예시 단계·진행 상태·이력·범위·견적 계산 | `product-demo.mjs` |
| 등장 효과·스크롤 애니메이션 | `use-home-animation.ts` |
| 히어로·공통 색상·여백 | `../../app/figma-home.css` |
| 제품 체험 배치·반응형·활동 패널 | `../../app/product-demo.css` |

`WorkflowSection`은 `product-experience.tsx`에서 내보내며 `home-page.tsx`가 연결합니다. 제품 체험은 `product-demo.mjs`의 단일 reducer로 실행 단계(`step`), 선택 화면(`selected`), 진행 상태(`phase`), 완료 이력(`history`)과 범위(`scope`)를 관리합니다. 수동 선택은 자동 진행을 멈추고 실제 자동 완료 이력을 만들어 내지 않습니다. `demoQuote`는 같은 범위를 요구사항·금액·제안서에 반영합니다. 모든 예시는 가상이며 실제 API·AI 요청·고객 데이터 저장을 하지 않습니다.

자동 진행은 실행 1.8초·완료 1.5초, 최종 완료 뒤 4.2초 후 반복합니다. 사용자 정지·포인터·내부 초점·동작 줄이기·화면 밖·비활성 탭에서는 멈춥니다. 각 효과는 unmount 시 타이머·리스너·observer를 정리합니다. 기본 콘텐츠는 애니메이션 없이 읽을 수 있어야 합니다. 상단의 Pretendard·보라/라벤더와 사용자 배치를 유지합니다.

`workflow-preview.mjs`는 이전 매핑의 테스트에서만 사용하며 현재 랜딩 실행에는 연결되지 않습니다. 삭제된 `home-content.ts`, `workflow-section.tsx`, `evidence-section.tsx`, `outcome-section.tsx`를 구현 대상으로 참조하지 않습니다. 공통 `app/components/live-workflow.tsx`는 실제 업무 화면용이므로 변경 시 해당 화면도 확인합니다.

Node 22에서 `npm run preview:check`를 실행합니다. 로컬 production 서버를 127.0.0.1:3100에 시작한 뒤 `npm run test:ui`로 검증합니다. 다른 포트는 `PLAYWRIGHT_BASE_URL`로 지정합니다. 브라우저 테스트는 외부 요청을 차단하고 Business API를 로컬 fixture로 대체합니다. 제품 체험 검수와 배포 범위는 `docs/frontend/UI_RELEASE_20261001.md`를 참고합니다.
