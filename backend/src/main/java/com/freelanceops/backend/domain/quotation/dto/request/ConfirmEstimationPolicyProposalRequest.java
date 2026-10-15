package com.freelanceops.backend.domain.quotation.dto.request;

import jakarta.validation.constraints.NotNull;

import java.util.UUID;

/** 확인 토큰은 클라이언트가 보낸 단가 대신 서버에 저장한 변경안을 가리킨다. */
public record ConfirmEstimationPolicyProposalRequest(@NotNull UUID confirmationToken) {}
