package com.freelanceops.backend.domain.agentrun.entity;

import com.freelanceops.backend.domain.agentrun.model.AgentRunStatus;
import com.freelanceops.backend.domain.agentrun.model.Provider;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class AgentRunEntityTest {

    @Test
    void aDelayedQueuedAcknowledgementCannotRegressARunningProjection() {
        Instant now = Instant.parse("2026-08-24T00:00:00Z");
        AgentRunEntity run = run(AgentRunStatus.RUNNING, now);

        run.synchronizeStatus(AgentRunStatus.QUEUED, now.plusSeconds(1));

        assertThat(run.status()).isEqualTo(AgentRunStatus.RUNNING);
    }

    @Test
    void waitingCanMoveBackToQueuedWhenAResumeCommandIsAccepted() {
        Instant now = Instant.parse("2026-08-24T00:00:00Z");
        AgentRunEntity run = run(AgentRunStatus.WAITING_FOR_USER, now);

        run.synchronizeStatus(AgentRunStatus.QUEUED, now.plusSeconds(1));

        assertThat(run.status()).isEqualTo(AgentRunStatus.QUEUED);
    }

    private static AgentRunEntity run(AgentRunStatus status, Instant now) {
        return new AgentRunEntity(
            UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
            Provider.OPENAI, "gpt-test", status, now
        );
    }
}
