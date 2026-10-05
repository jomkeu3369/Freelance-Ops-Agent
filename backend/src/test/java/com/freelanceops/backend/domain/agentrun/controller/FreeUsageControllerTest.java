package com.freelanceops.backend.domain.agentrun.controller;

import com.freelanceops.backend.domain.agentrun.service.FreeUsageService;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.UUID;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class FreeUsageControllerTest {
    @Test void rejectsFractionalNegativeMissingAndOverCapLimitsBeforeMutation() throws Exception {
        var service = mock(FreeUsageService.class);
        var mvc = MockMvcBuilders.standaloneSetup(new FreeUsageController(service)).build();
        for (String limit : new String[]{"5.5", "-1", "100001", "null", "10000000000000000000000"}) {
            mvc.perform(patch("/api/v2/admin/free-usage")
                .principal(new TestingAuthenticationToken(UUID.randomUUID().toString(), "unused", "ROLE_USER"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"limit\":" + limit + ",\"expectedEpoch\":0,\"expectedUpdatedAt\":\"2026-10-01T00:00:00Z\"}"))
                .andExpect(status().isBadRequest());
        }
        verifyNoInteractions(service);
    }
    @Test void rejectsMissingAndAnonymousSubjects() throws Exception {
        var service = mock(FreeUsageService.class);
        var mvc = MockMvcBuilders.standaloneSetup(new FreeUsageController(service)).build();
        mvc.perform(get("/api/v2/admin/free-usage")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v2/admin/free-usage").principal(new TestingAuthenticationToken("anonymousUser", "unused")))
            .andExpect(status().isUnauthorized());
        verifyNoInteractions(service);
    }
    @Test void modelRateRejectsZeroFractionMissingEnabledAndOversizedValues() throws Exception {
        var service = mock(FreeUsageService.class);
        var mvc = MockMvcBuilders.standaloneSetup(new FreeUsageController(service)).build();
        for (String credits : new String[]{"0", "-1", "0.5", "100001", "null"}) {
            mvc.perform(patch("/api/v2/admin/free-usage/models")
                .principal(new TestingAuthenticationToken(UUID.randomUUID().toString(), "unused", "ROLE_USER"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"provider\":\"OPENAI\",\"model\":\"gpt-5.6-luna\",\"credits\":" + credits
                    + ",\"enabled\":true,\"expectedEpoch\":0,\"expectedUpdatedAt\":\"2026-10-01T00:00:00Z\"}"))
                .andExpect(status().isBadRequest());
        }
        mvc.perform(patch("/api/v2/admin/free-usage/models")
            .principal(new TestingAuthenticationToken(UUID.randomUUID().toString(), "unused", "ROLE_USER"))
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"provider\":\"OPENAI\",\"model\":\"gpt-5.6-luna\",\"credits\":10,\"expectedEpoch\":0,\"expectedUpdatedAt\":\"2026-10-01T00:00:00Z\"}"))
            .andExpect(status().isBadRequest());
        verifyNoInteractions(service);
    }
}
