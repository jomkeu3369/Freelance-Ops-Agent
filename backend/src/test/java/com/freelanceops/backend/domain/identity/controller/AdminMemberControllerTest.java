package com.freelanceops.backend.domain.identity.controller;

import com.freelanceops.backend.domain.identity.service.AdminMemberService;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.UUID;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class AdminMemberControllerTest {
    @Test void costReadsRejectMissingUnauthenticatedAndNonUuidActorsBeforeDelegating() throws Exception {
        var service = mock(AdminMemberService.class);
        var mvc = MockMvcBuilders.standaloneSetup(new AdminMemberController(service)).build();
        String member = UUID.randomUUID().toString();
        for (String suffix : new String[]{"/ai-usage", "/ai-usage/history"}) {
            String path = "/api/v2/admin/members/" + member + suffix;
            mvc.perform(get(path)).andExpect(status().isUnauthorized());
            mvc.perform(get(path).principal(new TestingAuthenticationToken(UUID.randomUUID().toString(), "unused")))
                .andExpect(status().isUnauthorized());
            mvc.perform(get(path).principal(new TestingAuthenticationToken("not-a-uuid", "unused", "ROLE_ADMIN")))
                .andExpect(status().isUnauthorized());
        }
        verifyNoInteractions(service);
    }

    @Test void costReadsUseAuthenticatedActorAndPathTargetWithBoundedHistoryDefaults() throws Exception {
        var service = mock(AdminMemberService.class);
        var mvc = MockMvcBuilders.standaloneSetup(new AdminMemberController(service)).build();
        UUID actor = UUID.randomUUID(), target = UUID.randomUUID();
        var principal = new TestingAuthenticationToken(actor.toString(), "unused", "ROLE_USER");
        String path = "/api/v2/admin/members/" + target + "/ai-usage";
        mvc.perform(get(path).param("userId", actor.toString()).principal(principal)).andExpect(status().isOk());
        mvc.perform(get(path + "/history").principal(principal)).andExpect(status().isOk());
        mvc.perform(get(path + "/history").param("cursor", "opaque-cursor").param("limit", "35").principal(principal))
            .andExpect(status().isOk());
        verify(service).usage(actor, target);
        verify(service).usageHistory(actor, target, null, 20);
        verify(service).usageHistory(actor, target, "opaque-cursor", 35);
        verifyNoMoreInteractions(service);
    }
}
