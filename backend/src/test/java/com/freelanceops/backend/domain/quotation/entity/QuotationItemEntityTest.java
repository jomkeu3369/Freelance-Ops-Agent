package com.freelanceops.backend.domain.quotation.entity;

import org.junit.jupiter.api.Test;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

class QuotationItemEntityTest {
    @Test
    void itemRequiresExactlyOneEvidenceOrAssumption() {
        assertThatThrownBy(() -> item(null, null)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> item(UUID.randomUUID(), UUID.randomUUID())).isInstanceOf(IllegalArgumentException.class);
    }

    private static QuotationItemEntity item(UUID assumptionId, UUID evidenceId) {
        return new QuotationItemEntity(
            UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), null, "항목", null,
            BigDecimal.ONE, "DAY", BigDecimal.TEN, BigDecimal.TEN, BigDecimal.ZERO,
            BigDecimal.ZERO, BigDecimal.TEN, assumptionId, evidenceId, 0, Instant.now()
        );
    }
}
