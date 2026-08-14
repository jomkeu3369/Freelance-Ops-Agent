package com.freelanceops.backend.global.security;

import jakarta.servlet.FilterChain;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

class ApiRateLimitFilterTest {

    private static final Clock CLOCK = Clock.fixed(Instant.parse("2026-08-14T00:00:00Z"), ZoneOffset.UTC);

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void limitsPublicAuthenticationRequestsByRemoteAddress() throws Exception {
        ApiRateLimitFilter filter = new ApiRateLimitFilter(true, 2, 2, 2, 100, CLOCK);
        FilterChain chain = mock(FilterChain.class);

        MockHttpServletResponse first = invoke(filter, chain, "/api/v2/auth/login", "203.0.113.10");
        MockHttpServletResponse second = invoke(filter, chain, "/api/v2/auth/login", "203.0.113.10");
        MockHttpServletResponse rejected = invoke(filter, chain, "/api/v2/auth/login", "203.0.113.10");

        assertThat(first.getStatus()).isEqualTo(200);
        assertThat(second.getStatus()).isEqualTo(200);
        assertThat(rejected.getStatus()).isEqualTo(429);
        assertThat(rejected.getHeader("Retry-After")).isEqualTo("60");
        assertThat(rejected.getContentAsString()).contains("RATE_LIMIT_EXCEEDED");
        verify(chain, times(2)).doFilter(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any());
    }

    @Test
    void isolatesAuthenticatedAgentLimitsByUser() throws Exception {
        ApiRateLimitFilter filter = new ApiRateLimitFilter(true, 1, 1, 1, 100, CLOCK);
        FilterChain chain = mock(FilterChain.class);
        String path = "/api/v2/workspaces/00000000-0000-0000-0000-000000000001/projects/"
            + "00000000-0000-0000-0000-000000000002/agent-runs";

        authenticate("user-a");
        assertThat(invoke(filter, chain, path, "203.0.113.10").getStatus()).isEqualTo(200);
        assertThat(invoke(filter, chain, path, "203.0.113.11").getStatus()).isEqualTo(429);

        authenticate("user-b");
        assertThat(invoke(filter, chain, path, "203.0.113.10").getStatus()).isEqualTo(200);
    }

    @Test
    void ignoresReadOnlyAndUnrelatedRequests() throws Exception {
        ApiRateLimitFilter filter = new ApiRateLimitFilter(true, 1, 1, 1, 100, CLOCK);
        FilterChain chain = mock(FilterChain.class);
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v2/workspaces/demo/projects");
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(request, response, chain);

        verify(chain).doFilter(request, response);
        assertThat(response.getStatus()).isEqualTo(200);
    }

    private static MockHttpServletResponse invoke(ApiRateLimitFilter filter, FilterChain chain, String path, String address)
        throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", path);
        request.setRemoteAddr(address);
        MockHttpServletResponse response = new MockHttpServletResponse();
        filter.doFilter(request, response, chain);
        return response;
    }

    private static void authenticate(String name) {
        TestingAuthenticationToken authentication = new TestingAuthenticationToken(name, null);
        authentication.setAuthenticated(true);
        SecurityContextHolder.getContext().setAuthentication(authentication);
    }
}
