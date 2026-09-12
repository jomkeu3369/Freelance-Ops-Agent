# 메인 소개 화면 수정 안내

주소 `/`의 실제 화면 코드는 이 폴더에 있습니다. `app/page.tsx`는 화면을 연결하고 기존 스타일을 불러오는 진입점입니다.

| 수정하려는 내용 | 파일 |
| --- | --- |
| 영역 표시 순서, 영역 추가·제거 | `home-page.tsx` |
| 작동 방식·견적 근거·결과 예시 문구 | `home-content.ts` |
| 상단 메뉴와 테마 전환 | `components/home-header.tsx` |
| 첫 소개, 제품 설명, 산출물, 대상 사용자, 시작 버튼, 하단 메뉴 | `components/home-sections.tsx` |
| 작동 방식 자동 전환과 실시간 분석 예시 | `components/workflow-section.tsx` |
| 견적 항목 선택과 연결 근거 | `components/evidence-section.tsx` |
| 완료 프로젝트 결과 예시 전환 | `components/outcome-section.tsx` |
| 등장 효과와 스크롤 애니메이션 | `use-home-animation.ts` |
| 색상, 여백, 반응형 배치 | `../../app/figma-home.css` |

각 상호작용 영역은 선택 상태와 타이머를 자체 관리합니다. 다른 영역을 수정하지 않고 개별적으로 작업할 수 있습니다. `home-page.tsx`의 `use client` 선언 아래에서 영역들이 실행되므로 각 파일에 같은 선언을 반복하지 않아도 됩니다.

소개 화면의 예시는 `home-content.ts`에서 관리하며 실제 고객 데이터가 아닙니다. 공통 분석 표시 컴포넌트 `app/components/live-workflow.tsx`는 프로젝트 화면에서도 사용하므로 변경할 때 두 화면을 함께 확인해 주세요.

2026-09-12부터 소개 화면은 밝은 도입부·어두운 강조 구간·근거 확인·시작 버튼 구간으로 대비를 준다. `use-home-animation.ts`는 GSAP matchMedia로 동작 줄이기 설정 변경과 unmount 시 애니메이션을 정리한다. 콘텐츠의 기본 CSS는 애니메이션 없이도 읽을 수 있어야 한다.

`workflow-live-preview`는 12열 그리드 전체를 차지해야 한다(`grid-column: 1 / -1`, `width: 100%`, `min-width: 0`). 작은 화면에서는 내부 그래프만 가로 스크롤하며 키보드로도 초점을 줄 수 있다. 자동 전환은 사용자 정지·카드 조작·동작 줄이기·탭 비활성 상태에서 멈춘다. 시연 이벤트는 화면 읽기 도구로 반복 방송하지 않으며 실제 업무 실행의 알림은 유지한다.
