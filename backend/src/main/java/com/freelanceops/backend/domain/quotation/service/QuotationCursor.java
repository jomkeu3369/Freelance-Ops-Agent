package com.freelanceops.backend.domain.quotation.service;

import com.freelanceops.backend.domain.quotation.entity.QuotationEntity;

import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.Base64;
import java.util.UUID;

/** 커서는 정렬 위치만 나타낸다. 조회마다 워크스페이스와 프로젝트 조건을 적용한다. */
record QuotationCursor(Instant createdAt, UUID id) {
    static QuotationCursor decode(String value) {
        if (value == null) return null;
        try {
            if (value.isEmpty() || value.length() > 160) throw new IllegalArgumentException();
            String decoded =
                    new String(Base64.getUrlDecoder().decode(value), StandardCharsets.UTF_8);
            String[] parts = decoded.split("\\|", -1);
            if (parts.length != 2) throw new IllegalArgumentException();
            Instant createdAt = Instant.parse(parts[0]);
            // 데이터베이스와 견적 날짜에서 처리 가능한 연도 범위만 허용한다.
            if (createdAt.isBefore(Instant.parse("0001-01-01T00:00:00Z"))
                    || !createdAt.isBefore(Instant.parse("+10000-01-01T00:00:00Z")))
                throw new IllegalArgumentException();
            UUID id = UUID.fromString(parts[1]);
            if (!id.toString().equals(parts[1])) throw new IllegalArgumentException();
            return new QuotationCursor(createdAt, id);
        } catch (IllegalArgumentException | DateTimeParseException error) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid quotation cursor");
        }
    }

    static String encode(QuotationEntity quotation) {
        return Base64.getUrlEncoder()
                .withoutPadding()
                .encodeToString(
                        (quotation.createdAt() + "|" + quotation.id())
                                .getBytes(StandardCharsets.UTF_8));
    }
}
