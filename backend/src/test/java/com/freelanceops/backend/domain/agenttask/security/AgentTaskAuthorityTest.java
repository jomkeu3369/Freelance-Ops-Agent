package com.freelanceops.backend.domain.agenttask.security;

import com.freelanceops.backend.domain.internaltool.security.DelegationPrincipal;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

class AgentTaskAuthorityTest {

    @Test
    void reportOnlyTokenCannotControlTasks() {
        UUID userId = UUID.randomUUID();
        var principal = new DelegationPrincipal(userId.toString(), "report", UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), userId, Set.of("agent.task.report"));
        var authority = new AgentTaskAuthority();
        authority.requireReport(principal);
        assertThatThrownBy(() -> authority.requireControl(principal)).isInstanceOf(ResponseStatusException.class);
    }
}
