package com.freelanceops.backend.global.mcp;

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
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(controllers = ReadOnlyMcpController.class, properties = {
    "app.mcp.read-only.enabled=true",
    "app.auth.jwt-secret=test-web-auth-secret-with-at-least-32-bytes",
    "app.auth.issuer=test-issuer",
    "app.auth.audience=test-web"
})
@Import({SecurityConfig.class, AuthSecurityConfig.class})
class ReadOnlyMcpSecurityWebTest {
    @Autowired private MockMvc mvc;
    @Autowired private JwtEncoder jwtEncoder;
    @MockitoBean private McpReadOnlyService service;
    @MockitoBean private DelegationTokenFilter delegationTokenFilter;

    @BeforeEach
    void passPublicRequestsThroughInternalFilter() throws Exception {
        doAnswer(invocation -> {
            FilterChain chain = invocation.getArgument(2);
            chain.doFilter(invocation.getArgument(0), invocation.getArgument(1));
            return null;
        }).when(delegationTokenFilter).doFilter(any(), any(), any());
    }

    @Test
    void tokenRequiredAndAuthenticatedSubjectControlsTenantScope() throws Exception {
        UUID workspaceId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        String body = """
            {"jsonrpc":"2.0","id":1,"method":"tools/list","params":{"_meta":{
            "io.modelcontextprotocol/protocolVersion":"2026-07-28",
            "io.modelcontextprotocol/clientInfo":{"name":"contract-test","version":"1"},
            "io.modelcontextprotocol/clientCapabilities":{}}}}
            """;
        var request = post("/api/v2/workspaces/{workspaceId}/mcp", workspaceId)
            .contentType("application/json")
            .accept("application/json", "text/event-stream")
            .header("MCP-Protocol-Version", ReadOnlyMcpController.VERSION)
            .header("Mcp-Method", "tools/list")
            .content(body);
        mvc.perform(request).andExpect(status().isUnauthorized());
        verifyNoInteractions(service);

        when(service.tools(userId, workspaceId)).thenReturn(List.of());
        mvc.perform(post("/api/v2/workspaces/{workspaceId}/mcp", workspaceId)
                .header("Authorization", "Bearer " + token(userId))
                .contentType("application/json")
                .accept("application/json", "text/event-stream")
                .header("MCP-Protocol-Version", ReadOnlyMcpController.VERSION)
                .header("Mcp-Method", "tools/list")
                .content(body))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.result.tools.length()").value(0));
        verify(service).tools(userId, workspaceId);
    }

    private String token(UUID userId) {
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
            JwsHeader.with(MacAlgorithm.HS256).type("JWT").build(), claims
        )).getTokenValue();
    }
}
