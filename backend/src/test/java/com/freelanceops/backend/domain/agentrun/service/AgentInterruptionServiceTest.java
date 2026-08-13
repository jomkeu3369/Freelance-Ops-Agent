package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.dto.request.ResumeAgentRunRequest;
import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView;
import com.freelanceops.backend.domain.agentrun.entity.AgentInterruptionEntity;
import com.freelanceops.backend.domain.agentrun.entity.AgentRunEntity;
import com.freelanceops.backend.domain.agentrun.model.AgentRunStatus;
import com.freelanceops.backend.domain.agentrun.model.InterruptionKind;
import com.freelanceops.backend.domain.agentrun.model.InterruptionStatus;
import com.freelanceops.backend.domain.agentrun.model.Provider;
import com.freelanceops.backend.domain.agentrun.repository.AgentInterruptionRepository;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class AgentInterruptionServiceTest {

    private final AgentInterruptionRepository repository = mock(AgentInterruptionRepository.class);
    private final AgentInterruptionService service = new AgentInterruptionService(repository);

    @Test
    void createsWorkspaceScopedPendingInterruptionFromAgentView() {
        AgentRunEntity run = run();
        UUID interruptionId = UUID.randomUUID();
        AgentRunView view = view(run.id(), interruptionId, AgentRunStatus.WAITING_FOR_USER);
        when(repository.findByIdAndWorkspaceIdAndAgentRunId(interruptionId, run.workspaceId(), run.id()))
            .thenReturn(Optional.empty());
        when(repository.findFirstByWorkspaceIdAndAgentRunIdAndStatus(run.workspaceId(), run.id(), InterruptionStatus.PENDING))
            .thenReturn(Optional.empty());

        service.synchronize(run, view);

        ArgumentCaptor<AgentInterruptionEntity> captor = ArgumentCaptor.forClass(AgentInterruptionEntity.class);
        verify(repository).save(captor.capture());
        assertThat(captor.getValue().workspaceId()).isEqualTo(run.workspaceId());
        assertThat(captor.getValue().questions()).containsExactly("예산 상한은 얼마인가요?");
        assertThat(captor.getValue().status()).isEqualTo(InterruptionStatus.PENDING);
    }

    @Test
    void rejectsDuplicateOrOutOfRangeAnswersBeforeAgentResume() {
        AgentRunEntity run = run();
        UUID interruptionId = UUID.randomUUID();
        AgentInterruptionEntity interruption = new AgentInterruptionEntity(
            interruptionId, run.workspaceId(), run.id(), InterruptionKind.CLARIFICATION,
            List.of("첫 질문", "둘째 질문"), Instant.now()
        );
        when(repository.findByIdAndWorkspaceIdAndAgentRunId(interruptionId, run.workspaceId(), run.id()))
            .thenReturn(Optional.of(interruption));
        ResumeAgentRunRequest request = new ResumeAgentRunRequest(
            interruptionId, "idempotency-key", List.of(
                new ResumeAgentRunRequest.ResumeAnswer(0, "첫 답변"),
                new ResumeAgentRunRequest.ResumeAnswer(0, "중복 답변")
            )
        );

        assertThatThrownBy(() -> service.requirePending(run, request))
            .isInstanceOf(ResponseStatusException.class)
            .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode().value()).isEqualTo(400));
    }

    @Test
    void recordsAnswersOnlyAfterAcceptedResume() {
        AgentRunEntity run = run();
        UUID interruptionId = UUID.randomUUID();
        AgentInterruptionEntity interruption = new AgentInterruptionEntity(
            interruptionId, run.workspaceId(), run.id(), InterruptionKind.CLARIFICATION,
            List.of("예산 상한은 얼마인가요?"), Instant.now()
        );
        ResumeAgentRunRequest request = new ResumeAgentRunRequest(
            interruptionId, "idempotency-key", List.of(new ResumeAgentRunRequest.ResumeAnswer(0, "500만원"))
        );

        service.markResponded(interruption, request, Instant.now());

        assertThat(interruption.status()).isEqualTo(InterruptionStatus.RESPONDED);
        assertThat(interruption.answers().getFirst())
            .containsEntry("questionIndex", 0)
            .containsEntry("answer", "500만원");
        verify(repository).save(interruption);
    }

    private static AgentRunEntity run() {
        return new AgentRunEntity(
            UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
            Provider.OPENAI, "gpt-test", AgentRunStatus.WAITING_FOR_USER, Instant.now()
        );
    }

    private static AgentRunView view(UUID runId, UUID interruptionId, AgentRunStatus status) {
        return new AgentRunView(
            runId, status, null,
            new AgentRunView.AgentInterruption(interruptionId, InterruptionKind.CLARIFICATION, List.of("예산 상한은 얼마인가요?")),
            null, null,
            new AgentRunView.AgentRunMetadata(Provider.OPENAI, "gpt-test", "v1", "v1", "trace"),
            null,
            Instant.now()
        );
    }
}
