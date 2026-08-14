package com.freelanceops.backend.domain.identity.controller;

import com.freelanceops.backend.domain.identity.dto.response.AuthTokenResponse;
import com.freelanceops.backend.domain.identity.dto.response.MeResponse;
import com.freelanceops.backend.domain.identity.service.AuthService;
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
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(
    controllers = {AuthController.class, MeController.class},
    properties = {
        "app.auth.jwt-secret=test-web-auth-secret-with-at-least-32-bytes",
        "app.auth.issuer=test-issuer",
        "app.auth.audience=test-web"
    }
)
@Import({SecurityConfig.class, AuthSecurityConfig.class})
class IdentitySecurityWebTest {

    @Autowired
    private MockMvc mockMvc;
    @Autowired
    private JwtEncoder jwtEncoder;

    @MockitoBean
    private AuthService authService;
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
    void authenticationEndpointsArePublicButMeRequiresBearerToken() throws Exception {
        UUID userId = UUID.randomUUID();
        when(authService.login(any())).thenReturn(new AuthTokenResponse(
            userId,
            UUID.randomUUID(),
            "access",
            Instant.now().plusSeconds(900),
            "refresh",
            Instant.now().plusSeconds(3600),
            "Bearer"
        ));

        mockMvc.perform(post("/api/v2/auth/login")
                .contentType("application/json")
                .content("{\"email\":\"member@example.com\",\"password\":\"valid-password\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.tokenType").value("Bearer"));

        mockMvc.perform(get("/api/v2/me"))
            .andExpect(status().isUnauthorized());
    }

    @Test
    void validAccessTokenSuppliesUuidSubjectToMeEndpoint() throws Exception {
        UUID userId = UUID.randomUUID();
        when(authService.me(userId)).thenReturn(new MeResponse(
            userId,
            "member@example.com",
            "Member",
            "ACTIVE",
            List.of()
        ));

        mockMvc.perform(get("/api/v2/me")
                .header("Authorization", "Bearer " + accessToken(userId)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.id").value(userId.toString()));

        verify(authService).me(userId);
    }

    @Test
    void actuatorMetricsAreNotPublicOrUserAccessible() throws Exception {
        mockMvc.perform(get("/actuator/metrics"))
            .andExpect(status().isUnauthorized());

        mockMvc.perform(get("/actuator/metrics")
                .header("Authorization", "Bearer " + accessToken(UUID.randomUUID())))
            .andExpect(status().isForbidden());
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
