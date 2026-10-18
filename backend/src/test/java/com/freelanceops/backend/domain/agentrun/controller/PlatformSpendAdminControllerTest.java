package com.freelanceops.backend.domain.agentrun.controller;

import com.freelanceops.backend.domain.agentrun.model.Provider;
import com.freelanceops.backend.domain.agentrun.service.PlatformSpendAdminService;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.math.BigDecimal;
import java.util.UUID;
import java.util.List;
import java.time.Instant;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class PlatformSpendAdminControllerTest {
    private final PlatformSpendAdminService service = mock(PlatformSpendAdminService.class);
    private final MockMvc mvc = MockMvcBuilders.standaloneSetup(new PlatformSpendAdminController(service)).build();
    private final UUID actor = UUID.randomUUID();
    private TestingAuthenticationToken principal() {
        return new TestingAuthenticationToken(actor.toString(), "unused", "ROLE_USER");
    }

    @Test void anonymousAndInvalidSubjectsAreUnauthorized() throws Exception {
        mvc.perform(get("/api/v2/admin/ai-spending")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v2/admin/ai-spending").principal(new TestingAuthenticationToken("anonymousUser", "unused")))
            .andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v2/admin/ai-spending").principal(new TestingAuthenticationToken("invalid-uuid", "unused", "ROLE_USER")))
            .andExpect(status().isUnauthorized());
        verifyNoInteractions(service);
    }

    @Test void budgetsRejectInvalidMoneyInEveryFieldBeforeMutation() throws Exception {
        for (String field : new String[]{"accountWeekUsd", "globalDayUsd", "globalWeekUsd"}) {
            for (String value : new String[]{"null", "-0.00000001", "100000.00000001", "0.000000001", "1e1000", "\"NaN\"", "\"Infinity\""}) {
                String body = "{\"accountWeekUsd\":1.25,\"globalDayUsd\":25,\"globalWeekUsd\":100,\"expectedRevision\":0}"
                    .replace("\"" + field + "\":" + (field.equals("accountWeekUsd") ? "1.25" : field.equals("globalDayUsd") ? "25" : "100"),
                        "\"" + field + "\":" + value);
                mvc.perform(patch("/api/v2/admin/ai-spending").principal(principal())
                    .contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isBadRequest());
            }
        }
        verifyNoInteractions(service);
    }

    @Test void revisionIsRequiredNonnegativeWholeAndWithinLongRange() throws Exception {
        for (String revision : new String[]{"null", "-1", "0.5", "9223372036854775808", "1e100", "\"NaN\""}) {
            mvc.perform(patch("/api/v2/admin/ai-spending").principal(principal()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"accountWeekUsd\":1,\"globalDayUsd\":1,\"globalWeekUsd\":1,\"expectedRevision\":" + revision + "}"))
                .andExpect(status().isBadRequest());
        }
        mvc.perform(patch("/api/v2/admin/ai-spending").principal(principal()).contentType(MediaType.APPLICATION_JSON)
            .content("{\"accountWeekUsd\":1,\"globalDayUsd\":1,\"globalWeekUsd\":1}")).andExpect(status().isBadRequest());
        verifyNoInteractions(service);
    }

    @Test void modelsRejectInvalidAmountsMissingEnabledUnknownProviderAndOversizedModel() throws Exception {
        for (String amount : new String[]{"null", "-1", "100.00000001", "0.123456789", "1e1000", "\"NaN\""}) {
            mvc.perform(patch("/api/v2/admin/ai-spending/models").principal(principal()).contentType(MediaType.APPLICATION_JSON)
                .content(modelBody(amount, "true", "OPENAI", "gpt-5.6-luna"))).andExpect(status().isBadRequest());
        }
        for (String body : new String[]{modelBody("0.1", "null", "OPENAI", "gpt-5.6-luna"),
            modelBody("0.1", "true", "UNKNOWN", "gpt-5.6-luna"), modelBody("0.1", "true", "OPENAI", "x".repeat(101))}) {
            mvc.perform(patch("/api/v2/admin/ai-spending/models").principal(principal()).contentType(MediaType.APPLICATION_JSON)
                .content(body)).andExpect(status().isBadRequest());
        }
        verifyNoInteractions(service);
    }

    @Test void deploymentSwitchResetAndUnknownFieldsCannotBeWritten() throws Exception {
        for (String extra : new String[]{"\"spendingEnabled\":true", "\"reset\":true", "\"revision\":0"}) {
            mvc.perform(patch("/api/v2/admin/ai-spending").principal(principal()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"accountWeekUsd\":1,\"globalDayUsd\":1,\"globalWeekUsd\":1,\"expectedRevision\":0," + extra + "}"))
                .andExpect(status().isBadRequest());
            mvc.perform(patch("/api/v2/admin/ai-spending/models").principal(principal()).contentType(MediaType.APPLICATION_JSON)
                .content(modelBody("0.1", "true", "OPENAI", "gpt-5.6-luna").replace("}", "," + extra + "}")))
                .andExpect(status().isBadRequest());
        }
        mvc.perform(post("/api/v2/admin/ai-spending/reset").principal(principal())).andExpect(status().isNotFound());
        verifyNoInteractions(service);
    }

    @Test void acceptsZeroAndEightPlaceDecimalNumbersOrStrings() throws Exception {
        var snapshot = snapshot("0", "0.00000001", "100000");
        when(service.changeBudgets(eq(actor), any(), any(), any(), eq(0L))).thenReturn(snapshot);
        when(service.changeModel(eq(actor), eq(Provider.OPENAI), eq("gpt-5.6-luna"), any(), eq(false), eq(0L))).thenReturn(snapshot);
        mvc.perform(patch("/api/v2/admin/ai-spending").principal(principal()).contentType(MediaType.APPLICATION_JSON)
            .content("{\"accountWeekUsd\":0,\"globalDayUsd\":\"0.00000001\",\"globalWeekUsd\":100000,\"expectedRevision\":0}"))
            .andExpect(status().isOk()).andExpect(jsonPath("accountWeekUsd").value("0"))
            .andExpect(jsonPath("globalDayUsd").value("0.00000001"))
            .andExpect(jsonPath("globalWeekUsd").value("100000"));
        verify(service).changeBudgets(eq(actor), eq(BigDecimal.ZERO), eq(new BigDecimal("0.00000001")),
            eq(new BigDecimal("100000")), eq(0L));
        mvc.perform(patch("/api/v2/admin/ai-spending/models").principal(principal()).contentType(MediaType.APPLICATION_JSON)
            .content(modelBody("0", "false", "OPENAI", "gpt-5.6-luna"))).andExpect(status().isOk());
        verify(service).changeModel(actor, Provider.OPENAI, "gpt-5.6-luna", BigDecimal.ZERO, false, 0L);
    }

    @Test void snapshotsPreserveExactLegacyBudgetsAsPlainDecimalStrings() throws Exception {
        when(service.settings(actor)).thenReturn(snapshot("99999999999.99999999", "100000.00000001", "0.00000001"));
        mvc.perform(get("/api/v2/admin/ai-spending").principal(principal()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("accountWeekUsd").isString()).andExpect(jsonPath("accountWeekUsd").value("99999999999.99999999"))
            .andExpect(jsonPath("globalDayUsd").isString()).andExpect(jsonPath("globalDayUsd").value("100000.00000001"))
            .andExpect(jsonPath("globalWeekUsd").isString()).andExpect(jsonPath("globalWeekUsd").value("0.00000001"))
            .andExpect(jsonPath("maxBudgetUsd").value(100000));
    }

    private PlatformSpendAdminService.Settings snapshot(String account, String day, String week) {
        return new PlatformSpendAdminService.Settings("USD", new BigDecimal(account), new BigDecimal(day), new BigDecimal(week),
            0L, Instant.parse("2026-10-06T00:00:00Z"), false, List.of(),
            PlatformSpendAdminService.MAX_BUDGET_USD, PlatformSpendAdminService.MAX_MODEL_RUN_USD);
    }

    private String modelBody(String amount, String enabled, String provider, String model) {
        return "{\"provider\":\"" + provider + "\",\"model\":\"" + model + "\",\"maxRunUsd\":" + amount
            + ",\"enabled\":" + enabled + ",\"expectedRevision\":0}";
    }
}
