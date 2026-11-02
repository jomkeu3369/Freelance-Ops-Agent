package com.freelanceops.backend.domain.identity.dto.response;

import java.time.Instant;
import java.util.List;

/** 관리자 목록 전용 페이지. 기존 OpenAPI의 PageMember·PageLogin·PageAudit 이름을 유지한다. */
public record Page<T>(List<T> items, long total, int page, int size, Instant recordingStartedAt) {}
