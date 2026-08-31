package com.freelanceops.backend.domain.agenttask.entity;

import com.freelanceops.backend.domain.agenttask.model.AgentTaskStatus;
import com.freelanceops.backend.domain.agentrun.model.DepartmentName;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class AgentTaskEntityTest {

    @Test
    void hardRedirectIncrementsRevisionAndRejectsLateResult() {
        Instant now = Instant.parse("2026-08-31T00:00:00Z");
        AgentTaskEntity task = task(now);
        int oldAttempt = task.dispatch(1, now);
        task.start(1, oldAttempt, now.plusSeconds(1));

        int revision = task.redirect(1, now.plusSeconds(2));

        assertThat(revision).isEqualTo(2);
        assertThat(task.status()).isEqualTo(AgentTaskStatus.QUEUED);
        assertThat(task.complete(1, oldAttempt, AgentTaskStatus.COMPLETED, now.plusSeconds(3))).isFalse();
    }

    @Test
    void heartbeatRequiresCurrentRevisionAndAttempt() {
        Instant now = Instant.parse("2026-08-31T00:00:00Z");
        AgentTaskEntity task = task(now);
        int attempt = task.dispatch(1, now);
        task.start(1, attempt, now.plusSeconds(1));

        task.heartbeat(1, attempt, "research", "collecting sources", now.plusSeconds(2));

        assertThat(task.lastHeartbeatAt()).isEqualTo(now.plusSeconds(2));
        assertThat(task.phase()).isEqualTo("research");
        assertThatThrownBy(() -> task.heartbeat(2, attempt, "late", "late", now.plusSeconds(3)))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("revision");
    }

    private static AgentTaskEntity task(Instant now) {
        return new AgentTaskEntity(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), null,
            DepartmentName.RESEARCH, "research-v1", "Research #1", "objective:1", 3, null, now);
    }
}
