package com.freelanceops.backend.domain.quotation.service;

import com.freelanceops.backend.domain.quotation.entity.QuotationEntity;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.UUID;

import static org.assertj.core.api.Assertions.*;

class QuotationCursorTest {
    @Test void roundTripPreservesPostgresMicrosecondsAndUnsignedUuidBoundary() {
        UUID id = UUID.fromString("ffffffff-ffff-ffff-ffff-ffffffffffff");
        Instant createdAt = Instant.parse("2026-10-12T02:00:00.123456Z");
        QuotationEntity entity = new QuotationEntity(id, UUID.randomUUID(), UUID.randomUUID(), id, null, 1,
            "RECOMMENDED", "KRW", BigDecimal.TEN, BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO,
            BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.TEN, null, UUID.randomUUID(), createdAt);
        assertThat(QuotationCursor.decode(QuotationCursor.encode(entity)))
            .isEqualTo(new QuotationCursor(createdAt, id));
        assertThat(QuotationCursor.decode(null)).isNull();
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "not-base64!", "a", "dGVzdA", "ICAg"})
    void malformedEncodingIsBadRequest(String cursor) { assertBadRequest(cursor); }

    @ParameterizedTest
    @ValueSource(strings = {
        "2026-10-12T00:00:00Z|not-a-uuid",
        "2026-10-12T00:00:00Z|1-1-1-1-1",
        "not-a-time|00000000-0000-0000-0000-000000000001",
        "+10000-01-01T00:00:00Z|00000000-0000-0000-0000-000000000001",
        "0000-01-01T00:00:00Z|00000000-0000-0000-0000-000000000001",
        "2026-10-12T00:00:00Z|00000000-0000-0000-0000-000000000001|extra"
    })
    void invalidOrderingBoundaryIsBadRequest(String raw) {
        assertBadRequest(Base64.getUrlEncoder().withoutPadding().encodeToString(raw.getBytes(StandardCharsets.UTF_8)));
    }

    @Test void oversizedCursorIsBadRequest() { assertBadRequest("a".repeat(161)); }

    private static void assertBadRequest(String cursor) {
        assertThatThrownBy(() -> QuotationCursor.decode(cursor))
            .isInstanceOfSatisfying(ResponseStatusException.class, error -> assertThat(error.getStatusCode().value()).isEqualTo(400));
    }
}
