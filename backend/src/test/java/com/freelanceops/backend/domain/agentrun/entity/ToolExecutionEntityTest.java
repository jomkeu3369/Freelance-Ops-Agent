package com.freelanceops.backend.domain.agentrun.entity;

import com.freelanceops.backend.domain.agentrun.model.ToolExecutionStatus;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ToolExecutionEntityTest {

    @Test
    void completesStartedExecutionWithDeterministicLatency() {
        Instant startedAt = Instant.parse("2026-08-13T00:00:00Z");
        ToolExecutionEntity execution = new ToolExecutionEntity(
            UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), "search_knowledge", "a".repeat(64), startedAt
        );

        execution.succeed("collection:size=3", startedAt.plusMillis(125));

        assertThat(execution.status()).isEqualTo(ToolExecutionStatus.SUCCEEDED);
        assertThat(execution.latencyMs()).isEqualTo(125);
        assertThat(execution.resultSummary()).isEqualTo("collection:size=3");
    }

    @Test
    void cannotCompleteExecutionTwice() {
        Instant startedAt = Instant.parse("2026-08-13T00:00:00Z");
        ToolExecutionEntity execution = new ToolExecutionEntity(
            UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), "calculate_quote", "b".repeat(64), startedAt
        );
        execution.fail("TOOL_PERMISSION_REQUIRED", startedAt.plusMillis(10));

        assertThatThrownBy(() -> execution.succeed("type=Quote", startedAt.plusMillis(20)))
            .isInstanceOf(IllegalStateException.class);
    }
}
