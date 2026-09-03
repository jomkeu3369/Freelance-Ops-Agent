package com.freelanceops.backend.domain.agenttask.service;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.anything;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

class ResearchRecoveryClientTest {

    @Test
    void sendsOnlyReferencesAndValidatesAcknowledgement() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        var client = new ResearchRecoveryClient(builder, "http://agent:8000");
        UUID runId = UUID.randomUUID();
        UUID taskId = UUID.randomUUID();
        UUID attemptId = UUID.randomUUID();
        var body = new ResearchRecoveryClient.RecoveryRequest(taskId, 1, attemptId, 3, 1);
        server.expect(requestTo("http://agent:8000/internal/v1/agent-runs/" + runId + "/research-recovery"))
            .andExpect(method(HttpMethod.POST)).andExpect(header("Authorization", "Bearer fresh-token"))
            .andExpect(content().json("{\"taskId\":\"" + taskId + "\",\"taskRevision\":1,\"attemptId\":\"" + attemptId + "\",\"authorizationRevision\":3,\"budgetRevision\":1}"))
            .andRespond(withSuccess("{\"taskId\":\"" + taskId + "\",\"taskRevision\":1,\"attemptId\":\"" + attemptId + "\",\"status\":\"STAGED\",\"publishedEvents\":0}", MediaType.APPLICATION_JSON));
        client.restore(runId, body, "fresh-token");
        server.verify();
    }

    @Test
    void rejectsWrongAttemptAcknowledgement() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        var client = new ResearchRecoveryClient(builder, "http://agent:8000");
        UUID taskId = UUID.randomUUID();
        var body = new ResearchRecoveryClient.RecoveryRequest(taskId, 1, UUID.randomUUID(), 3, 1);
        server.expect(anything()).andRespond(withSuccess("{\"taskId\":\"" + taskId + "\",\"taskRevision\":1,\"attemptId\":\"" + UUID.randomUUID() + "\",\"status\":\"STAGED\",\"publishedEvents\":0}", MediaType.APPLICATION_JSON));
        assertThatThrownBy(() -> client.restore(UUID.randomUUID(), body, "fresh-token"))
            .isInstanceOf(IllegalStateException.class).hasMessageContaining("acknowledgement");
    }
}
