package com.freelanceops.backend.domain.internaltool.security;

import jakarta.servlet.FilterChain;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class DelegationTokenFilterTest {

    private final DelegationTokenVerifier verifier = mock(DelegationTokenVerifier.class);
    private final DelegationTokenFilter filter = new DelegationTokenFilter(verifier);
    private final FilterChain chain = mock(FilterChain.class);

    @Test
    void bindsVerifiedPrincipalToMatchingRun() throws Exception {
        UUID runId = UUID.randomUUID();
        DelegationPrincipal principal = principal(runId);
        when(verifier.verify("token")).thenReturn(principal);
        MockHttpServletRequest request = request(runId);
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(request, response, chain);

        verify(chain).doFilter(request, response);
        assertThat(request.getAttribute(DelegationTokenFilter.PRINCIPAL_ATTRIBUTE)).isEqualTo(principal);
    }

    @Test
    void rejectsTokenBoundToAnotherRun() throws Exception {
        UUID requestRunId = UUID.randomUUID();
        when(verifier.verify("token")).thenReturn(principal(UUID.randomUUID()));
        MockHttpServletRequest request = request(requestRunId);
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(request, response, chain);

        assertThat(response.getStatus()).isEqualTo(401);
        assertThat(response.getContentType()).isEqualTo("application/problem+json");
        assertThat(response.getContentAsString()).contains("DELEGATION_TOKEN_INVALID");
        verify(chain, never()).doFilter(request, response);
    }

    private static MockHttpServletRequest request(UUID runId) {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/internal/v1/projects/test/context");
        request.addHeader("Authorization", "Bearer token");
        request.addHeader("X-Run-Id", runId.toString());
        return request;
    }

    private static DelegationPrincipal principal(UUID runId) {
        UUID userId = UUID.randomUUID();
        return new DelegationPrincipal(
            userId.toString(), UUID.randomUUID().toString(), runId, UUID.randomUUID(), UUID.randomUUID(), userId,
            Set.of("agent.run", "project.read")
        );
    }
}


