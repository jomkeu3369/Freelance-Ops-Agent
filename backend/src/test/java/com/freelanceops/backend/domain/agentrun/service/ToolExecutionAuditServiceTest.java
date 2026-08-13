package com.freelanceops.backend.domain.agentrun.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.freelanceops.backend.domain.agentrun.entity.ToolExecutionEntity;
import com.freelanceops.backend.domain.agentrun.model.ToolExecutionStatus;
import com.freelanceops.backend.domain.agentrun.repository.AgentRunRepository;
import com.freelanceops.backend.domain.agentrun.repository.ToolExecutionRepository;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.web.server.ResponseStatusException;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ToolExecutionAuditServiceTest {

    private final ToolExecutionRepository executionRepository = mock(ToolExecutionRepository.class);
    private final AgentRunRepository runRepository = mock(AgentRunRepository.class);
    private final Instant now = Instant.parse("2026-08-13T00:00:00Z");
    private final ToolExecutionAuditService service = new ToolExecutionAuditService(
        executionRepository, runRepository, new ObjectMapper(), Clock.fixed(now, ZoneOffset.UTC)
    );

    @Test
    void recordsOnlyInputHashAndSafeResultSummary() {
        UUID workspaceId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();
        when(runRepository.existsByIdAndWorkspaceId(runId, workspaceId)).thenReturn(true);
        when(executionRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        List<String> result = service.execute(
            "search_knowledge", Map.of("query", "민감한 고객 요구사항"), workspaceId, runId,
            () -> List.of("first", "second")
        );

        ArgumentCaptor<ToolExecutionEntity> captor = ArgumentCaptor.forClass(ToolExecutionEntity.class);
        verify(executionRepository, org.mockito.Mockito.times(2)).save(captor.capture());
        ToolExecutionEntity execution = captor.getValue();
        assertThat(result).hasSize(2);
        assertThat(execution.inputHash()).matches("[0-9a-f]{64}");
        assertThat(execution.inputHash()).doesNotContain("민감한");
        assertThat(execution.resultSummary()).isEqualTo("collection:size=2");
        assertThat(execution.status()).isEqualTo(ToolExecutionStatus.SUCCEEDED);
    }

    @Test
    void rejectsTokenForUnknownWorkspaceRunBeforeOperation() {
        UUID workspaceId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();
        when(runRepository.existsByIdAndWorkspaceId(runId, workspaceId)).thenReturn(false);

        assertThatThrownBy(() -> service.execute(
            "calculate_quote", Map.of(), workspaceId, runId, () -> "not-called"
        )).isInstanceOf(ResponseStatusException.class);
        verify(executionRepository, never()).save(any());
    }
}
