package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.entity.AgentRunEntity;
import com.freelanceops.backend.domain.agentrun.model.AgentRunStatus;
import com.freelanceops.backend.domain.agentrun.repository.AgentRunRepository;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.springframework.context.ApplicationEventPublisher;
import java.util.Optional;
import java.util.UUID;
import static org.mockito.Mockito.*;

class AgentRunProjectionQuotaTest {
    @ParameterizedTest
    @EnumSource(value = AgentRunStatus.class, names = {"COMPLETED", "PARTIAL", "FAILED", "CANCELLED"})
    void localFailureNeverRefundsButAcknowledgedTerminalStatusSettles(AgentRunStatus terminal) {
        var repository = mock(AgentRunRepository.class);
        var usage = mock(FreeUsageService.class);
        var run = mock(AgentRunEntity.class);
        UUID id = UUID.randomUUID(), workspace = UUID.randomUUID();
        when(repository.findByIdAndWorkspaceIdForUpdate(id, workspace)).thenReturn(Optional.of(run));
        when(run.id()).thenReturn(id);
        var service = new AgentRunProjectionService(repository, mock(AgentInterruptionService.class),
            mock(AgentCostService.class), mock(ApplicationEventPublisher.class), usage);
        service.synchronizeStatus(id, workspace, AgentRunStatus.FAILED);
        verifyNoInteractions(usage);
        service.synchronizeAcknowledgedStatus(id, workspace, terminal);
        verify(usage).settleConfirmed(id, terminal);
    }
}
