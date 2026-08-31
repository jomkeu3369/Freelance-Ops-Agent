package com.freelanceops.backend.domain.agenttask.service;

import com.freelanceops.backend.domain.agenttask.dto.request.AgentTaskExecutionProfileRequest;
import com.freelanceops.backend.domain.agenttask.entity.AgentTaskEntity;
import com.freelanceops.backend.domain.agenttask.entity.AgentTaskExecutionProfileEntity;
import com.freelanceops.backend.domain.agenttask.repository.AgentTaskExecutionProfileRepository;
import com.freelanceops.backend.domain.internaltool.security.DelegationPrincipal;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class AgentTaskRegistrationServiceTest {

    private final AgentTaskRegistry registry = mock(AgentTaskRegistry.class);
    private final AgentTaskGuard guard = mock(AgentTaskGuard.class);
    private final AgentTaskExecutionProfileRepository profiles = mock(AgentTaskExecutionProfileRepository.class);
    private final AgentTaskRegistrationService service = new AgentTaskRegistrationService(registry, guard, profiles);

    @Test
    void validatesBeforeRegisteringTaskAndImmutableProfile() {
        AgentTaskEntity task = mock(AgentTaskEntity.class);
        AgentTaskEntity registered = mock(AgentTaskEntity.class);
        AgentTaskExecutionProfileRequest request = mock(AgentTaskExecutionProfileRequest.class);
        AgentTaskExecutionProfileEntity validated = mock(AgentTaskExecutionProfileEntity.class);
        DelegationPrincipal principal = mock(DelegationPrincipal.class);
        Instant now = Instant.parse("2026-08-31T00:00:00Z");
        when(guard.validate(task, request, principal, now)).thenReturn(validated);
        when(registry.register(task, List.of(), now)).thenReturn(registered);

        assertThat(service.register(task, List.of(), request, principal, now)).isSameAs(registered);

        InOrder order = inOrder(guard, registry, profiles);
        order.verify(guard).validate(task, request, principal, now);
        order.verify(registry).register(task, List.of(), now);
        order.verify(profiles).saveAndFlush(validated);
    }

    @Test
    void guardRejectionPreventsAnyPersistence() {
        AgentTaskEntity task = mock(AgentTaskEntity.class);
        AgentTaskExecutionProfileRequest request = mock(AgentTaskExecutionProfileRequest.class);
        DelegationPrincipal principal = mock(DelegationPrincipal.class);
        Instant now = Instant.parse("2026-08-31T00:00:00Z");
        when(guard.validate(task, request, principal, now)).thenThrow(new IllegalStateException("rejected"));

        assertThatThrownBy(() -> service.register(task, List.of(), request, principal, now))
            .isInstanceOf(IllegalStateException.class).hasMessage("rejected");
        verifyNoInteractions(registry, profiles);
    }

    @Test
    void registrationBoundaryIsTransactional() throws NoSuchMethodException {
        var method = AgentTaskRegistrationService.class.getMethod("register", AgentTaskEntity.class,
            java.util.Collection.class, AgentTaskExecutionProfileRequest.class, DelegationPrincipal.class,
            Instant.class);

        assertThat(method.getAnnotation(Transactional.class)).isNotNull();
    }
}
