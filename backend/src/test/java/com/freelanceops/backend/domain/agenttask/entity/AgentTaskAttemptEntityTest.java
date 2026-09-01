package com.freelanceops.backend.domain.agenttask.entity;

import com.freelanceops.backend.domain.agenttask.model.AgentTaskAttemptStatus;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class AgentTaskAttemptEntityTest {

    @Test
    void onlyLeaseOwnerCanStartBeforeExpiry() {
        Instant now = Instant.parse("2026-08-31T00:00:00Z");
        AgentTaskAttemptEntity attempt = attempt(now);
        attempt.lease("worker-1", Duration.ofSeconds(30), now);

        assertThatThrownBy(() -> attempt.start("worker-2", now.plusSeconds(1)))
            .isInstanceOf(IllegalStateException.class);

        attempt.start("worker-1", now.plusSeconds(1));
        assertThat(attempt.status()).isEqualTo(AgentTaskAttemptStatus.RUNNING);
    }

    @Test
    void supersedingActiveAttemptClearsLease() {
        Instant now = Instant.parse("2026-08-31T00:00:00Z");
        AgentTaskAttemptEntity attempt = attempt(now);
        attempt.lease("worker-1", Duration.ofSeconds(30), now);

        attempt.supersede(now.plusSeconds(1));

        assertThat(attempt.status()).isEqualTo(AgentTaskAttemptStatus.SUPERSEDED);
        assertThat(attempt.leaseOwner()).isNull();
        assertThat(attempt.leaseUntil()).isNull();
    }

    @Test
    void softUpdateResumesOnlyFromCheckpoint() {
        Instant now = Instant.parse("2026-08-31T00:00:00Z");
        AgentTaskAttemptEntity attempt = attempt(now);
        attempt.projectStarted(now.plusSeconds(1));
        attempt.projectCheckpointed(now.plusSeconds(2));

        assertThat(attempt.projectUpdateApplied(now.plusSeconds(3))).isTrue();
        assertThat(attempt.status()).isEqualTo(AgentTaskAttemptStatus.RUNNING);
    }

    private static AgentTaskAttemptEntity attempt(Instant now) {
        return new AgentTaskAttemptEntity(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), 1, 1,
            12.0, "predictor-v1", Map.of("route", "SUPERVISOR"), now);
    }
}
