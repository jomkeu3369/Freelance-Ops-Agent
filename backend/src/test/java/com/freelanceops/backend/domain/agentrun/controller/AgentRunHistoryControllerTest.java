package com.freelanceops.backend.domain.agentrun.controller;

import com.freelanceops.backend.domain.agentrun.service.AgentRunHistoryService;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;

class AgentRunHistoryControllerTest {
    @Test
    void rejectsMissingAuthenticationBeforeAccessingHistory() {
        AgentRunHistoryService history = mock(AgentRunHistoryService.class);
        AgentRunHistoryController controller = new AgentRunHistoryController(history);

        assertThatThrownBy(() -> controller.list(UUID.randomUUID(), UUID.randomUUID(), 20, null))
            .isInstanceOfSatisfying(ResponseStatusException.class,
                error -> assertThat(error.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED));
        verifyNoInteractions(history);
    }
}
