package com.freelanceops.backend.domain.quotation.entity;

import org.junit.jupiter.api.Test;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

class QuotationEntityTest {
    @Test
    void publishedQuotationCannotBePublishedOrMutatedAgain() {
        QuotationEntity quotation = new QuotationEntity(
            UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), null, 1,
            "RECOMMENDED", "KRW", new BigDecimal("100.00"), BigDecimal.ZERO,
            BigDecimal.ZERO, BigDecimal.ZERO, new BigDecimal("0.1"), new BigDecimal("10.00"),
            new BigDecimal("110.00"), null, UUID.randomUUID(), Instant.now()
        );
        quotation.publish(UUID.randomUUID(), Instant.now());

        assertThatThrownBy(() -> quotation.publish(UUID.randomUUID(), Instant.now()))
            .isInstanceOf(IllegalStateException.class);
    }
}
