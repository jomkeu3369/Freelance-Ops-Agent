package com.freelanceops.backend.domain.agentrun.controller;

import com.freelanceops.backend.domain.agentrun.client.AgentEventStream;
import com.freelanceops.backend.domain.agentrun.service.AgentEventRelay;
import com.freelanceops.backend.domain.agentrun.service.AgentRunGatewayService;
import jakarta.servlet.AsyncEvent;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockAsyncContext;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.io.InputStream;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class AgentRunEventStreamTest {
    @Test
    void servletTimeoutClosesUpstreamSoBrowserCanReconnectWithItsCursor() throws Exception {
        AgentRunGatewayService gateway = mock(AgentRunGatewayService.class);
        InputStream body = mock(InputStream.class);
        UUID user = UUID.randomUUID(), workspace = UUID.randomUUID(), run = UUID.randomUUID();
        when(gateway.events(eq(user), eq(workspace), eq(run), eq(7L), anyString()))
            .thenReturn(new AgentEventStream(body));
        var mvc = MockMvcBuilders.standaloneSetup(
            new AgentRunController(gateway, mock(AgentEventRelay.class), 250)).build();
        var result = mvc.perform(get("/api/v2/workspaces/{workspace}/agent-runs/{run}/events", workspace, run)
                .principal(new TestingAuthenticationToken(user.toString(), "unused", "ROLE_USER"))
                .header("Last-Event-ID", "7"))
            .andExpect(status().isOk()).andExpect(request().asyncStarted()).andReturn();

        MockAsyncContext context = (MockAsyncContext) result.getRequest().getAsyncContext();
        assertThat(context.getTimeout()).isEqualTo(250L);
        for (var listener : context.getListeners()) listener.onTimeout(new AsyncEvent(context));
        verify(body).close();
        verify(gateway).events(eq(user), eq(workspace), eq(run), eq(7L), anyString());
    }
}
