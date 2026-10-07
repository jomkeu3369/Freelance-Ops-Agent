package com.freelanceops.backend.domain.agentrun.controller;
import com.freelanceops.backend.domain.agentrun.service.PlatformUsageService;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import java.util.UUID;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
class PlatformUsageControllerTest {
    @Test void rejectsAnonymousAndAlwaysUsesAuthenticatedSubject() throws Exception {
        var service=mock(PlatformUsageService.class);
        var mvc=MockMvcBuilders.standaloneSetup(new PlatformUsageController(service)).build();
        mvc.perform(get("/api/v2/me/ai-usage")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v2/me/ai-usage/history")).andExpect(status().isUnauthorized());
        verifyNoInteractions(service);
        UUID user=UUID.randomUUID();
        var principal=new TestingAuthenticationToken(user.toString(),"unused","ROLE_USER");
        mvc.perform(get("/api/v2/me/ai-usage").param("userId",UUID.randomUUID().toString()).principal(principal))
            .andExpect(status().isOk());
        mvc.perform(get("/api/v2/me/ai-usage/history").principal(principal)).andExpect(status().isOk());
        verify(service).snapshot(user); verify(service).history(user,null,20);
    }
}
