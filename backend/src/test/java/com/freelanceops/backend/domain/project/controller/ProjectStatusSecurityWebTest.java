package com.freelanceops.backend.domain.project.controller;

import com.freelanceops.backend.domain.project.service.ProjectService;
import com.freelanceops.backend.domain.project.model.ProjectStatus;
import com.freelanceops.backend.domain.internaltool.security.DelegationTokenFilter;
import com.freelanceops.backend.global.config.AuthSecurityConfig;
import com.freelanceops.backend.global.config.SecurityConfig;
import jakarta.servlet.FilterChain;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(
    controllers = ProjectController.class,
    properties = {
        "app.auth.jwt-secret=test-web-auth-secret-with-at-least-32-bytes",
        "app.auth.issuer=test-issuer",
        "app.auth.audience=test-web"
    }
)
@Import({SecurityConfig.class, AuthSecurityConfig.class})
class ProjectStatusSecurityWebTest {

    @Autowired
    private MockMvc mockMvc;
    @Autowired
    private JwtEncoder jwtEncoder;

    @MockitoBean
    private ProjectService projectService;
    @MockitoBean
    private DelegationTokenFilter delegationTokenFilter;

    @BeforeEach
    void letPublicRequestsPassDelegationFilter() throws Exception {
        doAnswer(invocation -> {
            FilterChain chain = invocation.getArgument(2);
            chain.doFilter(invocation.getArgument(0), invocation.getArgument(1));
            return null;
        }).when(delegationTokenFilter).doFilter(any(), any(), any());
    }

    @Test
    void statusChangeRequiresBearerToken() throws Exception {
        mockMvc.perform(patch("/api/v2/workspaces/{workspaceId}/projects/{projectId}/status", UUID.randomUUID(), UUID.randomUUID())
                .contentType("application/json").content("{\"status\":\"QUOTING\"}"))
            .andExpect(status().isUnauthorized());
        verifyNoInteractions(projectService);
    }

    @Test
    void statusOnlyRequestReachesWorkspaceScopedService() throws Exception {
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        mockMvc.perform(patch("/api/v2/workspaces/{workspaceId}/projects/{projectId}/status", workspaceId, projectId)
                .header("Authorization", "Bearer " + accessToken(userId))
                .contentType("application/json").content("{\"status\":\"QUOTING\"}"))
            .andExpect(status().isOk());
        verify(projectService).updateStatus(userId, workspaceId, projectId, ProjectStatus.QUOTING);
    }

    @Test
    void missingOrUnknownStatusIsRejected() throws Exception {
        String token = accessToken(UUID.randomUUID());
        for (String body : List.of("{}", "{\"status\":\"UNKNOWN\"}")) {
            mockMvc.perform(patch("/api/v2/workspaces/{workspaceId}/projects/{projectId}/status", UUID.randomUUID(), UUID.randomUUID())
                    .header("Authorization", "Bearer " + token)
                    .contentType("application/json").content(body))
                .andExpect(status().isBadRequest());
        }
        verifyNoInteractions(projectService);
    }
    private String accessToken(UUID userId) {
        Instant now = Instant.now();
        JwtClaimsSet claims = JwtClaimsSet.builder()
            .issuer("test-issuer")
            .subject(userId.toString())
            .audience(List.of("test-web"))
            .issuedAt(now)
            .expiresAt(now.plusSeconds(60))
            .claim("token_type", "access")
            .build();
        return jwtEncoder.encode(JwtEncoderParameters.from(
            JwsHeader.with(MacAlgorithm.HS256).type("JWT").build(),
            claims
        )).getTokenValue();
    }
}
