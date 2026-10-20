# 기존 세 견적안 동료 프로필

이 문서는 초기 핵심안·권장안·확장안 프로필의 호환 계약이다. 현재 생성·선택·보관 화면은 [개인 동료 안내](CUSTOM_AGENT_PETS.md)를 따른다.

## 보존되는 계약

- `GET /api/v2/workspaces/{workspaceId}/pets`: 본인의 세 프로필을 읽는다. 미저장 슬롯은 기본값이다.
- `PUT /api/v2/workspaces/{workspaceId}/pets`: 닫힌 `PetProfile`을 검증해 슬롯별로 저장한다.
- 이름·동물·색상·장식·말투·판단 성향은 권한이나 사용 도구를 변경하지 않는다.
- 현재 멤버십과 `agent.run`을 검사한다. 같은 워크스페이스의 다른 Owner도 본인 프로필만 변경한다.
- 실행 시작 시 프로필 스냅샷을 저장한다. 현재 프로필을 바꾸거나 지워도 과거 실행·의견의 모습은 바뀌지 않는다.

V34의 프로필·생성 요청 이력은 V44의 개인 동료 모음과 별개다. 개인 동료를 처음 저장하기 전의 기존 계정과 과거 실행을 읽을 때 이 호환 경로가 필요하다.

## 별도 유료 생성

이전 설계의 `POST /projects/{projectId}/pet-generations`는 활성 기능으로 안내하지 않는다. Agent는 예산 경계가 없는 `PETS` 요청을 모델 호출 전에 거부한다. 과거 `pet_generation` 이력만으로 금액 예약·정산을 증명하지 않는다.

새 개인 동료는 별도 `/agent-pets/generations` 경로에서 플랫폼 공통 원장으로 금액을 예약·정산하고 픽셀 외형을 생성한다. 상세 계약은 [개인 동료 안내](CUSTOM_AGENT_PETS.md)와 [ADR-0045](../adr/0045-generated-pixel-pets.md)을 따른다. 초기 설계와 검증의 근거는 [ADR-0032](../adr/0032-personal-pet-profiles.md), [동료 검증 기록](../testing/frontend-ai-pets-2026-09-12.md)에 보존한다.
