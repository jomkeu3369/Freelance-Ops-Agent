package com.freelanceops.backend.domain.agenttask.entity;

import com.freelanceops.backend.domain.agenttask.model.AgentTaskCommandDeliveryStatus;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class AgentTaskCommandDeliveryEntityTest {

    @Test
    void staleDeliveryAttemptCannotAcknowledgeReclaimedCommand() {
        Instant now = Instant.parse("2026-08-31T00:00:00Z");
        AgentTaskCommandDeliveryEntity delivery = new AgentTaskCommandDeliveryEntity(UUID.randomUUID(), now);
        delivery.claim(now, Duration.ofSeconds(5));
        int staleAttempt = delivery.attempts();
        delivery.claim(now.plusSeconds(6), Duration.ofSeconds(5));

        assertThat(delivery.delivered(staleAttempt, now.plusSeconds(7))).isFalse();
        assertThat(delivery.status()).isEqualTo(AgentTaskCommandDeliveryStatus.PROCESSING);
        assertThat(delivery.delivered(delivery.attempts(), now.plusSeconds(7))).isTrue();
        assertThat(delivery.status()).isEqualTo(AgentTaskCommandDeliveryStatus.DELIVERED);
    }
}
