package com.freelanceops.backend.domain.agentrun.client;

import com.freelanceops.backend.domain.agentrun.client.dto.request.InternalAgentRunRequest.AgentInput;
import com.freelanceops.backend.domain.agentrun.model.AgentRunStatus;
import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView;
import com.freelanceops.backend.domain.agentrun.client.dto.request.InternalAgentRunRequest;
import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest.ModelSelection;
import com.freelanceops.backend.domain.agentrun.model.Provider;
import com.freelanceops.backend.domain.agentrun.model.ReasoningEffort;
import com.freelanceops.backend.domain.agentrun.dto.request.ResumeAgentRunRequest;
import com.freelanceops.backend.domain.agentrun.dto.request.ResumeAgentRunRequest.ResumeAnswer;
import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest.RunBudget;
import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest.SafetyContext;
import com.freelanceops.backend.domain.agentrun.dto.response.StartAgentRunResponse;
import com.freelanceops.backend.domain.agentrun.client.dto.request.InternalAgentRunRequest.TrustedRunContext;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

import java.util.List;
import java.util.UUID;
import java.net.http.HttpClient;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

class HttpAgentRunClientTest {

    @Test
    void sendsVersionedAgentContractWithBearerTokenAndTraceContext() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        HttpAgentRunClient client = testClient(builder);
        UUID runId = UUID.randomUUID();
        String traceparent = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
        server.expect(requestTo("http://agent:8000/internal/v1/agent-runs"))
            .andExpect(method(HttpMethod.POST))
            .andExpect(header("Authorization", "Bearer signed-token"))
            .andExpect(header("traceparent", traceparent))
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(content().string(containsString("\"runId\":\"" + runId + "\"")))
            .andExpect(content().string(containsString("\"requirementText\":\"요구사항\"")))
            .andRespond(withSuccess(
                "{\"runId\":\"" + runId + "\",\"status\":\"QUEUED\",\"acceptedAt\":\"2026-08-13T10:00:00Z\"}",
                MediaType.APPLICATION_JSON
            ));

        StartAgentRunResponse response = client.start(request(runId, traceparent), "signed-token", traceparent);

        assertThat(response.runId()).isEqualTo(runId);
        assertThat(response.status()).isEqualTo(AgentRunStatus.QUEUED);
        server.verify();
    }

    @Test
    void forwardsLifecycleCommandsUsingTheSameRunScopedContract() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        HttpAgentRunClient client = testClient(builder);
        UUID runId = UUID.randomUUID();
        UUID interruptionId = UUID.randomUUID();
        String traceparent = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
        String view = viewJson(runId, "WAITING_FOR_USER");

        server.expect(requestTo("http://agent:8000/internal/v1/agent-runs/" + runId))
            .andExpect(method(HttpMethod.GET))
            .andExpect(header("Authorization", "Bearer signed-token"))
            .andRespond(withSuccess(view, MediaType.APPLICATION_JSON));
        server.expect(requestTo("http://agent:8000/internal/v1/agent-runs/" + runId + "/resume"))
            .andExpect(method(HttpMethod.POST))
            .andExpect(header("traceparent", traceparent))
            .andRespond(withSuccess(
                "{\"runId\":\"" + runId + "\",\"status\":\"QUEUED\",\"acceptedAt\":\"2026-08-13T10:00:00Z\"}",
                MediaType.APPLICATION_JSON
            ));
        server.expect(requestTo("http://agent:8000/internal/v1/agent-runs/" + runId + "/cancel"))
            .andExpect(method(HttpMethod.POST))
            .andExpect(header("Authorization", "Bearer signed-token"))
            .andRespond(withSuccess(viewJson(runId, "CANCELLED"), MediaType.APPLICATION_JSON));

        AgentRunView fetched = client.get(runId, "signed-token", traceparent);
        StartAgentRunResponse resumed = client.resume(
            runId,
            new ResumeAgentRunRequest(
                interruptionId,
                "idempotency-key",
                List.of(new ResumeAnswer(0, "확인했습니다."))
            ),
            "signed-token",
            traceparent
        );
        AgentRunView cancelled = client.cancel(runId, "signed-token", traceparent);

        assertThat(fetched.status()).isEqualTo(AgentRunStatus.WAITING_FOR_USER);
        assertThat(fetched.usage()).isNotNull();
        assertThat(fetched.usage().modelCalls()).isEqualTo(3);
        assertThat(fetched.usage().inputTokens()).isEqualTo(1200);
        assertThat(resumed.status()).isEqualTo(AgentRunStatus.QUEUED);
        assertThat(cancelled.status()).isEqualTo(AgentRunStatus.CANCELLED);
        server.verify();
    }

    @Test
    void productionTransportUsesHttp11ForUvicornCompatibility() {
        assertThat(HttpAgentRunClient.http11Client().version()).isEqualTo(HttpClient.Version.HTTP_1_1);
    }

    @Test
    void deserializesStructuredQuotationDraftWithoutPrices() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        HttpAgentRunClient client = testClient(builder);
        UUID runId = UUID.randomUUID();
        String traceparent = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
        String result = "{\"projectSummary\":\"분석 완료\",\"openQuestions\":[],\"departmentResults\":[],"
            + "\"quotationDraft\":{\"scenario\":\"RECOMMENDED\",\"items\":[{\"title\":\"API 구현\","
            + "\"description\":\"인증 API\",\"quantity\":16,\"unit\":\"HOUR\","
            + "\"rateCardHint\":\"백엔드 개발\",\"basis\":{\"type\":\"ASSUMPTION\","
            + "\"content\":\"사양 확정 가정\",\"sourceReference\":null,\"sourceTitle\":null}}]}}";
        String view = "{\"runId\":\"" + runId + "\",\"status\":\"COMPLETED\",\"result\":" + result
            + ",\"metadata\":{\"provider\":\"OPENAI\",\"model\":\"gpt-test\",\"promptVersion\":\"v1\","
            + "\"toolSchemaVersion\":\"v1\",\"traceId\":\"trace\"},\"updatedAt\":\"2026-08-13T10:00:00Z\"}";
        server.expect(requestTo("http://agent:8000/internal/v1/agent-runs/" + runId))
            .andRespond(withSuccess(view, MediaType.APPLICATION_JSON));

        AgentRunView response = client.get(runId, "signed-token", traceparent);

        assertThat(response.result().quotationDraft().items()).hasSize(1);
        assertThat(response.result().quotationDraft().items().getFirst().title()).isEqualTo("API 구현");
        server.verify();
    }

    private static HttpAgentRunClient testClient(RestClient.Builder builder) {
        return new HttpAgentRunClient(builder, "http://agent:8000", HttpAgentRunClient.http11Client());
    }

    private static InternalAgentRunRequest request(UUID runId, String traceparent) {
        UUID userId = UUID.randomUUID();
        return new InternalAgentRunRequest(
            new TrustedRunContext(
                runId,
                UUID.randomUUID(),
                traceparent,
                UUID.randomUUID(),
                UUID.randomUUID(),
                userId,
                List.of("agent.run", "project.read")
            ),
            new RunBudget(120, 5, 10, 10000, 5000, 2, 2, 5, 1, 2),
            new ModelSelection(Provider.OPENAI, "gpt-test", ReasoningEffort.LOW),
            new SafetyContext(false, false, false, false, false, false, true),
            new AgentInput("요구사항", "ko-KR", "KR", null)
        );
    }

    private static String viewJson(UUID runId, String status) {
        return "{\"runId\":\"" + runId + "\",\"status\":\"" + status
            + "\",\"metadata\":{\"provider\":\"OPENAI\",\"model\":\"gpt-test\","
            + "\"promptVersion\":\"v1\",\"toolSchemaVersion\":\"v1\",\"traceId\":\"trace\"},"
            + "\"usage\":{\"requestTier\":\"DEPARTMENT\",\"modelCalls\":3,\"toolCalls\":1,"
            + "\"inputTokens\":1200,\"outputTokens\":300,\"cachedTokens\":100,\"searchCredits\":0,"
            + "\"crawledPages\":0,\"retryCount\":1,\"durationMs\":2500},"
            + "\"updatedAt\":\"2026-08-13T10:00:00Z\"}";
    }
}


