package com.freelanceops.backend.domain.agentrun.entity;

import com.freelanceops.backend.domain.agentrun.model.AgentRunCommandStatus;
import com.freelanceops.backend.domain.agentrun.model.AgentRunCommandType;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class AgentRunCommandEntityTest {

    @Test
    void anExpiredProcessingLeaseCanBeReclaimedAfterAProcessCrash() {
        Instant createdAt = Instant.parse("2026-08-24T00:00:00Z");
        AgentRunCommandEntity command = command(createdAt);
        command.claim(createdAt, Duration.ofMinutes(2));

        assertThat(command.dispatchableAt(createdAt.plusSeconds(119))).isFalse();
        assertThat(command.dispatchableAt(createdAt.plusSeconds(120))).isTrue();

        command.claim(createdAt.plusSeconds(120), Duration.ofMinutes(2));
        assertThat(command.attempts()).isEqualTo(2);
        assertThat(command.status()).isEqualTo(AgentRunCommandStatus.PROCESSING);
    }

    @Test
    void aCompletedCommandCannotBeClaimedAgain() {
        Instant now = Instant.parse("2026-08-24T00:00:00Z");
        AgentRunCommandEntity command = command(now);
        command.claim(now, Duration.ofMinutes(2));
        command.complete(now.plusSeconds(1), 1);

        assertThat(command.dispatchableAt(now.plus(Duration.ofDays(1)))).isFalse();
        assertThatThrownBy(() -> command.claim(now.plus(Duration.ofDays(1)), Duration.ofMinutes(2)))
            .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void aStaleWorkerCannotOverwriteANewerClaim() {
        Instant now = Instant.parse("2026-08-24T00:00:00Z");
        AgentRunCommandEntity command = command(now);
        command.claim(now, Duration.ofSeconds(1));
        command.claim(now.plusSeconds(1), Duration.ofMinutes(2));

        assertThat(command.retry(now.plusSeconds(2), Duration.ofSeconds(1), "stale", 1)).isFalse();
        assertThat(command.status()).isEqualTo(AgentRunCommandStatus.PROCESSING);
        assertThat(command.attempts()).isEqualTo(2);
    }

    private static AgentRunCommandEntity command(Instant now) {
        return new AgentRunCommandEntity(
            UUID.randomUUID(), UUID.randomUUID(), AgentRunCommandType.START, "{}", UUID.randomUUID(),
            "[]", "traceparent", now
        );
    }
}
