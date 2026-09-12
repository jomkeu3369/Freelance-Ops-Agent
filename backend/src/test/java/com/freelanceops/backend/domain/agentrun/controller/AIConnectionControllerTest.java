package com.freelanceops.backend.domain.agentrun.controller;

import com.freelanceops.backend.domain.agentrun.service.AIConnectionService;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import java.util.UUID;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class AIConnectionControllerTest {
    @Test void invalidInputNeverSerializesRejectedSecret() throws Exception {
        var service = mock(AIConnectionService.class);
        var mvc = MockMvcBuilders.standaloneSetup(new AIConnectionController(service)).setControllerAdvice(new AIConnectionExceptionHandler()).build();
        mvc.perform(put("/api/v2/workspaces/" + UUID.randomUUID() + "/ai-connections/OPENAI")
            .principal(new TestingAuthenticationToken(UUID.randomUUID().toString(), "unused"))
            .contentType(MediaType.APPLICATION_JSON).content("{\"model\":\"\",\"apiKey\":\"synthetic-sensitive-value\"}"))
            .andExpect(status().isBadRequest()).andExpect(content().string(org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("synthetic-sensitive-value"))));
        verifyNoInteractions(service);
    }
}
