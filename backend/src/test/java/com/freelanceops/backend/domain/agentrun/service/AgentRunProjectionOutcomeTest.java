package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView;
import com.freelanceops.backend.domain.agentrun.entity.AgentRunEntity;
import com.freelanceops.backend.domain.agentrun.model.AgentRunStatus;
import com.freelanceops.backend.domain.agentrun.model.DepartmentName;
import com.freelanceops.backend.domain.agentrun.model.Provider;
import com.freelanceops.backend.domain.agentrun.model.InterruptionKind;
import com.freelanceops.backend.domain.agentrun.model.RequestTier;
import com.freelanceops.backend.domain.agentrun.repository.AgentRunRepository;
import com.freelanceops.backend.global.event.RequirementAnalysisCompleted;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.springframework.context.ApplicationEventPublisher;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class AgentRunProjectionOutcomeTest {
    @ParameterizedTest
    @EnumSource(value = AgentRunStatus.class, names = {"QUEUED", "RUNNING"})
    void answeredQuestionCannotRollBackAnAcceptedResume(AgentRunStatus resumed) {
        var fixture = new Fixture(resumed);
        var prior = fixture.completed();
        var answered = new AgentRunView.AgentInterruption(UUID.randomUUID(), InterruptionKind.CLARIFICATION, List.of("Answered?"));
        var stale = new AgentRunView(fixture.run.id(), AgentRunStatus.WAITING_FOR_USER, DepartmentName.REQUIREMENTS,
            answered, prior.result(), null, null, prior.usage(), Instant.now());
        var repository = mock(com.freelanceops.backend.domain.agentrun.repository.AgentInterruptionRepository.class);
        var stored = new com.freelanceops.backend.domain.agentrun.entity.AgentInterruptionEntity(answered.interruptionId(),
            fixture.run.workspaceId(), fixture.run.id(), answered.kind(), answered.questions(), Instant.now());
        stored.respond(List.of(java.util.Map.of("questionIndex", 0, "answer", "Synthetic")), Instant.now());
        when(repository.findByIdAndWorkspaceIdAndAgentRunId(answered.interruptionId(), fixture.run.workspaceId(), fixture.run.id()))
            .thenReturn(Optional.of(stored));
        var projection = new AgentRunProjectionService(fixture.runs, new AgentInterruptionService(repository),
            fixture.costs, fixture.events, fixture.credits, fixture.byok);
        var publicView = projection.synchronize(fixture.run.id(), fixture.run.workspaceId(), stale);
        assertThat(fixture.run.status()).isEqualTo(resumed);
        assertThat(publicView.status()).isEqualTo(resumed);
        assertThat(publicView.interruption()).isNull();
        assertThat(publicView.result()).isSameAs(stale.result());
        verify(fixture.costs).synchronize(fixture.run, stale);
        verify(repository, never()).save(any());
    }

    @Test
    void aNewPendingQuestionStillTransitionsAResumedRunToWaiting() {
        var fixture = new Fixture(AgentRunStatus.RUNNING);
        var fresh = new AgentRunView(fixture.run.id(), AgentRunStatus.WAITING_FOR_USER, DepartmentName.RESEARCH,
            new AgentRunView.AgentInterruption(UUID.randomUUID(), InterruptionKind.CLARIFICATION, List.of("New question?")),
            null, null, null, null, Instant.now());
        var repository = mock(com.freelanceops.backend.domain.agentrun.repository.AgentInterruptionRepository.class);
        var projection = new AgentRunProjectionService(fixture.runs, new AgentInterruptionService(repository),
            fixture.costs, fixture.events, fixture.credits, fixture.byok);
        assertThat(projection.synchronize(fixture.run.id(), fixture.run.workspaceId(), fresh)).isSameAs(fresh);
        assertThat(fixture.run.status()).isEqualTo(AgentRunStatus.WAITING_FOR_USER);
        var saved = org.mockito.ArgumentCaptor.forClass(com.freelanceops.backend.domain.agentrun.entity.AgentInterruptionEntity.class);
        verify(repository).save(saved.capture());
        assertThat(saved.getValue().id()).isEqualTo(fresh.interruption().interruptionId());
        assertThat(saved.getValue().status()).isEqualTo(com.freelanceops.backend.domain.agentrun.model.InterruptionStatus.PENDING);
    }
    @ParameterizedTest
    @EnumSource(value = AgentRunStatus.class, names = {"PARTIAL", "FAILED", "CANCELLED"})
    void lateCompletionCannotPromoteADurableOutcomeOrPublishCompletedFactsButUsageStillSettles(AgentRunStatus terminal) {
        var fixture = new Fixture(terminal);
        var lateComplete = fixture.completed();
        var result = fixture.service.synchronize(fixture.run.id(), fixture.run.workspaceId(), lateComplete);
        assertThat(result.status()).isEqualTo(terminal);
        assertThat(fixture.run.status()).isEqualTo(terminal);
        assertThat(result.result()).isSameAs(lateComplete.result());
        assertThat(result.usage()).isSameAs(lateComplete.usage());
        assertThat(result.interruption()).isNull();
        verify(fixture.interruptions).synchronize(fixture.run, result);
        verify(fixture.costs).synchronize(fixture.run, lateComplete);
        verify(fixture.credits).settleConfirmed(fixture.run.id(), AgentRunStatus.COMPLETED);
        verify(fixture.byok).closeIfTerminal(fixture.run.id(), AgentRunStatus.COMPLETED);
        verifyNoInteractions(fixture.events);
    }

    @ParameterizedTest
    @EnumSource(value = AgentRunStatus.class, names = {"PARTIAL", "FAILED", "CANCELLED"})
    void aLateWaitingSnapshotCannotReopenATerminalRunsQuestion(AgentRunStatus terminal) {
        var fixture = new Fixture(terminal);
        var prior = fixture.completed();
        var staleQuestion = new AgentRunView(fixture.run.id(), AgentRunStatus.WAITING_FOR_USER, DepartmentName.REQUIREMENTS,
            new AgentRunView.AgentInterruption(UUID.randomUUID(), InterruptionKind.CLARIFICATION, List.of("Stale question?")),
            prior.result(), null, null, prior.usage(), Instant.now());
        var result = fixture.service.synchronize(fixture.run.id(), fixture.run.workspaceId(), staleQuestion);
        assertThat(result.status()).isEqualTo(terminal);
        assertThat(result.activeDepartment()).isNull();
        assertThat(result.interruption()).isNull();
        verify(fixture.interruptions).synchronize(fixture.run, result);
        verify(fixture.costs).synchronize(fixture.run, staleQuestion);
        assertThat(result.usage()).isSameAs(staleQuestion.usage());
        verifyNoInteractions(fixture.events);
    }

    @ParameterizedTest
    @EnumSource(value = AgentRunStatus.class, names = {"QUEUED", "RUNNING", "WAITING_FOR_USER", "PARTIAL", "FAILED", "CANCELLED"})
    void durableCompletionCannotPromoteAnOlderIncompletePayloadToCompletedFacts(AgentRunStatus staleStatus) {
        var fixture = new Fixture(AgentRunStatus.COMPLETED);
        var prior = fixture.completed();
        var older = new AgentRunView(fixture.run.id(), staleStatus, DepartmentName.REQUIREMENTS,
            new AgentRunView.AgentInterruption(UUID.randomUUID(), InterruptionKind.CLARIFICATION, List.of("Older question?")),
            prior.result(), null, null, prior.usage(), Instant.now());
        var result = fixture.service.synchronize(fixture.run.id(), fixture.run.workspaceId(), older);
        assertThat(result.status()).isEqualTo(AgentRunStatus.COMPLETED);
        assertThat(result.result()).isNull();
        assertThat(result.activeDepartment()).isNull();
        assertThat(result.interruption()).isNull();
        assertThat(result.usage()).isSameAs(older.usage());
        verify(fixture.costs).synchronize(fixture.run, older);
        verifyNoInteractions(fixture.events);
    }

    @Test void aRunningRunConvergesToCompletedAndPublishesItsCompletedDepartment() {
        var fixture = new Fixture(AgentRunStatus.RUNNING);
        var complete = fixture.completed();
        assertThat(fixture.service.synchronize(fixture.run.id(), fixture.run.workspaceId(), complete)).isSameAs(complete);
        assertThat(fixture.run.status()).isEqualTo(AgentRunStatus.COMPLETED);
        verify(fixture.events).publishEvent(new RequirementAnalysisCompleted(fixture.run.id(),
            fixture.run.workspaceId(), fixture.run.projectId(), fixture.run.initiatedBy(), "Requirements", List.of()));
        verify(fixture.costs).synchronize(fixture.run, complete);
    }

    private static final class Fixture {
        final AgentRunRepository runs = mock(AgentRunRepository.class);
        final AgentInterruptionService interruptions = mock(AgentInterruptionService.class);
        final AgentCostService costs = mock(AgentCostService.class);
        final ApplicationEventPublisher events = mock(ApplicationEventPublisher.class);
        final FreeUsageService credits = mock(FreeUsageService.class);
        final ByokExecutionService byok = mock(ByokExecutionService.class);
        final AgentRunEntity run;
        final AgentRunProjectionService service;
        Fixture(AgentRunStatus status) {
            run = new AgentRunEntity(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                UUID.randomUUID(), Provider.OPENAI, "fixture", status, Instant.now());
            when(runs.findByIdAndWorkspaceIdForUpdate(run.id(), run.workspaceId())).thenReturn(Optional.of(run));
            service = new AgentRunProjectionService(runs, interruptions, costs, events, credits, byok);
        }
        AgentRunView completed() {
            var department = new AgentRunView.DepartmentResult(DepartmentName.REQUIREMENTS, "COMPLETED",
                "Requirements", List.of(), List.of(), List.of(), null);
            var usage = new AgentRunView.AgentRunUsage(RequestTier.MULTI_DEPARTMENT, 0, 2, 0, 0, 0, 0, 0, 0, 100);
            return new AgentRunView(run.id(), AgentRunStatus.COMPLETED, null, null,
                new AgentRunView.AgentRunResult("Summary", List.of(), List.of(department), null, List.of()),
                null, null, usage, Instant.now());
        }
    }
}
