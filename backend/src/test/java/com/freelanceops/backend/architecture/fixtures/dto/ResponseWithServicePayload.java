package com.freelanceops.backend.architecture.fixtures.dto;

import com.freelanceops.backend.domain.workspace.service.WorkspaceProvisioningResult;

/** 구조 검사가 DTO 내부의 서비스 타입 노출도 탐지하는지 확인하는 테스트 전용 계약. */
public record ResponseWithServicePayload(WorkspaceProvisioningResult result) {}
