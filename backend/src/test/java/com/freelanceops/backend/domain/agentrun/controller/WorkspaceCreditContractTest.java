package com.freelanceops.backend.domain.agentrun.controller;

import com.freelanceops.backend.domain.agentrun.dto.request.ResumeAgentRunRequest;
import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest;
import com.freelanceops.backend.domain.agentrun.dto.response.StartAgentRunResponse;
import com.freelanceops.backend.domain.agentrun.model.AgentRunStatus;
import com.freelanceops.backend.domain.agentrun.service.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** Same synthetic fixture is exercised by the frontend's real HTTP client tests. */
class WorkspaceCreditContractTest {
    private static final UUID USER = UUID.fromString("11111111-1111-4111-8111-111111111111");
    private static final UUID WORKSPACE = UUID.fromString("44444444-4444-4444-8444-444444444444");
    private static final UUID PROJECT = UUID.fromString("55555555-5555-4555-8555-555555555555");
    private static final UUID RUN = UUID.fromString("66666666-6666-4666-8666-666666666666");
    private static final String START_PATH = "/api/v2/workspaces/" + WORKSPACE + "/projects/" + PROJECT + "/agent-runs";
    private final ObjectMapper mapper = new ObjectMapper();
    private final AgentRunGatewayService gateway = mock(AgentRunGatewayService.class);
    private final FreeUsageService usage = mock(FreeUsageService.class);
    private JsonNode fixture;
    private MockMvc mvc;

    @BeforeEach void setup() throws Exception {
        fixture = mapper.readTree(Files.readString(Path.of("..", "contracts", "fixtures", "workspace-credit-contract.json")));
        mvc = MockMvcBuilders.standaloneSetup(new AgentRunController(gateway, mock(AgentEventRelay.class)),
                new FreeUsageController(usage))
            .setControllerAdvice(new FreeUsageExceptionHandler(), new PlatformSpendExceptionHandler()).build();
    }
    private TestingAuthenticationToken user() {
        return new TestingAuthenticationToken(USER.toString(), "unused", "ROLE_USER");
    }
    private StartAgentRunResponse accepted() {
        return new StartAgentRunResponse(RUN, AgentRunStatus.QUEUED, Instant.parse("2026-10-04T12:00:00Z"));
    }
    private <T> T fixture(String name, Class<T> type) {
        return mapper.treeToValue(fixture.get(name), type);
    }

    @Test void platformStartPreservesExactInputAndMicrosecondPriceRevision() throws Exception {
        when(gateway.start(eq(USER), eq(WORKSPACE), eq(PROJECT), any(), anyString(), eq("synthetic-start-001")))
            .thenReturn(accepted());
        mvc.perform(post(START_PATH).principal(user()).contentType(MediaType.APPLICATION_JSON)
            .header("Idempotency-Key", "synthetic-start-001").content(fixture.get("start").toString()))
            .andExpect(status().isAccepted()).andExpect(jsonPath("runId").value(RUN.toString()));
        var captured = ArgumentCaptor.forClass(StartAgentRunRequest.class);
        verify(gateway).start(eq(USER), eq(WORKSPACE), eq(PROJECT), captured.capture(), anyString(), eq("synthetic-start-001"));
        assertThat(captured.getValue()).isEqualTo(fixture("start", StartAgentRunRequest.class));
        assertThat(captured.getValue().creditQuote().pricingUpdatedAt()).isEqualTo(Instant.parse("2026-10-04T12:00:00.123456Z"));
        assertThat(captured.getValue().requirementText()).startsWith("  ").endsWith("  ").contains("\n");
    }

    @Test void personalCredentialStartNeedsNoCustomerCreditQuote() throws Exception {
        when(gateway.start(eq(USER), eq(WORKSPACE), eq(PROJECT), any(), anyString(), isNull())).thenReturn(accepted());
        mvc.perform(post(START_PATH).principal(user()).contentType(MediaType.APPLICATION_JSON)
            .content(fixture.get("byokStart").toString())).andExpect(status().isAccepted());
        var captured = ArgumentCaptor.forClass(StartAgentRunRequest.class);
        verify(gateway).start(eq(USER), eq(WORKSPACE), eq(PROJECT), captured.capture(), anyString(), isNull());
        assertThat(captured.getValue()).isEqualTo(fixture("byokStart", StartAgentRunRequest.class));
        assertThat(captured.getValue().creditQuote()).isNull();
        assertThat(captured.getValue().modelSelection().credentialId()).isNotNull();
    }

    @Test void usageAndAdminSettingsSerializeTheExactFrontendShape() throws Exception {
        when(usage.current(USER)).thenReturn(fixture("usage", FreeUsageService.Usage.class));
        when(usage.adminSettings(USER)).thenReturn(fixture("settings", FreeUsageService.Settings.class));
        mvc.perform(get("/api/v2/usage/free").principal(user())).andExpect(status().isOk())
            .andExpect(content().json(fixture.get("usage").toString(), org.springframework.test.json.JsonCompareMode.STRICT));
        mvc.perform(get("/api/v2/admin/free-usage").principal(user())).andExpect(status().isOk())
            .andExpect(content().json(fixture.get("settings").toString(), org.springframework.test.json.JsonCompareMode.STRICT));
        when(usage.current(USER)).thenReturn(fixture("settledFailureUsage", FreeUsageService.Usage.class));
        mvc.perform(get("/api/v2/usage/free").principal(user())).andExpect(status().isOk())
            .andExpect(content().json(fixture.get("settledFailureUsage").toString(), org.springframework.test.json.JsonCompareMode.STRICT));
    }

    @Test void adminModelAndResetRequestsPreserveReviewedRevision() throws Exception {
        var model = fixture("adminModelChange", FreeUsageController.ChangeModel.class);
        var reset = fixture("adminReset", FreeUsageController.ResetAll.class);
        var settings = fixture("settings", FreeUsageService.Settings.class);
        when(usage.changeModelRate(USER, model.provider(), model.model(), model.credits().intValueExact(),
            model.enabled(), model.expectedEpoch(), model.expectedUpdatedAt())).thenReturn(settings);
        when(usage.resetAll(USER, reset.confirmation(), reset.expectedEpoch(), reset.expectedUpdatedAt())).thenReturn(settings);
        mvc.perform(patch("/api/v2/admin/free-usage/models").principal(user()).contentType(MediaType.APPLICATION_JSON)
            .content(fixture.get("adminModelChange").toString())).andExpect(status().isOk())
            .andExpect(content().json(fixture.get("settings").toString(), org.springframework.test.json.JsonCompareMode.STRICT));
        mvc.perform(post("/api/v2/admin/free-usage/reset").principal(user()).contentType(MediaType.APPLICATION_JSON)
            .content(fixture.get("adminReset").toString())).andExpect(status().isOk());
        verify(usage).changeModelRate(USER, model.provider(), model.model(), 15, false, 7L, model.expectedUpdatedAt());
        verify(usage).resetAll(USER, "RESET_ALL_FREE_USAGE", 7L, reset.expectedUpdatedAt());
    }

    @Test void resumeContractDoesNotIncludeAnotherCreditQuote() throws Exception {
        var resume = fixture("resume", ResumeAgentRunRequest.class);
        when(gateway.resume(eq(USER), eq(WORKSPACE), eq(RUN), eq(resume), anyString())).thenReturn(accepted());
        mvc.perform(post("/api/v2/workspaces/" + WORKSPACE + "/agent-runs/" + RUN + "/responses")
            .principal(user()).contentType(MediaType.APPLICATION_JSON).content(fixture.get("resume").toString()))
            .andExpect(status().isAccepted());
        verify(gateway).resume(eq(USER), eq(WORKSPACE), eq(RUN), eq(resume), anyString());
        verifyNoInteractions(usage);
    }

    @Test void pricingQuotaAndOperatingBudgetErrorsMatchTheFrontendContract() throws Exception {
        for (JsonNode error : fixture.get("errors")) {
            String code = error.get("body").get("code").asString();
            RuntimeException failure = switch (code) {
                case "PLATFORM_SPEND_EXHAUSTED" -> new PlatformSpendExhaustedException("ACCOUNT_WEEK");
                case "PLATFORM_SPEND_DISABLED" -> new PlatformSpendUnavailableException();
                case "FREE_USAGE_EXHAUSTED" -> new FreeUsageExhaustedException(fixture("usage", FreeUsageService.Usage.class), 100);
                default -> new CreditQuoteException(HttpStatus.valueOf(error.get("status").asInt()), code, error.get("body").get("message").asString());
            };
            doThrow(failure).when(gateway).start(eq(USER), eq(WORKSPACE), eq(PROJECT), any(), anyString(), isNull());
            mvc.perform(post(START_PATH).principal(user()).contentType(MediaType.APPLICATION_JSON)
                .content(fixture.get("start").toString())).andExpect(status().is(error.get("status").asInt()))
                .andExpect(content().json(error.get("body").toString(), org.springframework.test.json.JsonCompareMode.STRICT));
        }
    }
}
