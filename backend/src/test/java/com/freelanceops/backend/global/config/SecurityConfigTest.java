package com.freelanceops.backend.global.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.freelanceops.backend.global.security.ApiRateLimitFilter;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.DefaultCorsProcessor;
import org.springframework.web.filter.CorsFilter;

class SecurityConfigTest {

    private final SecurityConfig config = new SecurityConfig();

    @Test
    void corsUsesOnlyExplicitBrowserOriginsAndBearerHeaders() {
        CorsConfigurationSource source =
                config.corsConfigurationSource(
                        "http://localhost:3000, https://preview.example.com, http://localhost:3000");
        MockHttpServletRequest request =
                new MockHttpServletRequest("OPTIONS", "/api/v2/auth/login");
        CorsConfiguration cors = source.getCorsConfiguration(request);

        assertThat(cors).isNotNull();
        assertThat(cors.getAllowedOrigins())
                .containsExactly("http://localhost:3000", "https://preview.example.com");
        assertThat(cors.getAllowedOrigins()).doesNotContain("*");
        assertThat(cors.getAllowedHeaders())
                .contains("Authorization", "Last-Event-ID", "traceparent");
        assertThat(cors.getAllowCredentials()).isFalse();
    }

    @Test
    void corsAllowsAuthenticatedFolderHeadPreflightOnlyFromConfiguredOrigins() throws Exception {
        CorsConfigurationSource source =
                config.corsConfigurationSource("https://app.example.com");
        MockHttpServletRequest request =
                new MockHttpServletRequest("OPTIONS", "/api/v2/workspaces/demo/rate-card-folders");
        request.addHeader("Origin", "https://app.example.com");
        request.addHeader("Access-Control-Request-Method", "HEAD");
        request.addHeader("Access-Control-Request-Headers", "Authorization");
        MockHttpServletResponse response = new MockHttpServletResponse();

        assertThat(new DefaultCorsProcessor().processRequest(
                        source.getCorsConfiguration(request), request, response))
                .isTrue();
        assertThat(response.getHeader("Access-Control-Allow-Origin"))
                .isEqualTo("https://app.example.com");
        assertThat(response.getHeader("Access-Control-Allow-Methods")).contains("HEAD");
        assertThat(response.getHeader("Access-Control-Allow-Headers")).contains("Authorization");

        MockHttpServletRequest denied =
                new MockHttpServletRequest("OPTIONS", "/api/v2/workspaces/demo/rate-card-folders");
        denied.addHeader("Origin", "https://unlisted.example.com");
        denied.addHeader("Access-Control-Request-Method", "HEAD");
        denied.addHeader("Access-Control-Request-Headers", "Authorization");
        MockHttpServletResponse deniedResponse = new MockHttpServletResponse();

        assertThat(new DefaultCorsProcessor().processRequest(
                        source.getCorsConfiguration(denied), denied, deniedResponse))
                .isFalse();
        assertThat(deniedResponse.getStatus()).isEqualTo(403);
        assertThat(deniedResponse.getHeader("Access-Control-Allow-Origin")).isNull();
    }

    @Test
    void corsRejectsWildcardsPathsAndEmptyConfiguration() {
        assertThatThrownBy(() -> config.corsConfigurationSource("*"))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> config.corsConfigurationSource("https://example.com/path"))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> config.corsConfigurationSource(" , "))
                .isInstanceOf(IllegalStateException.class);
    }

    @ParameterizedTest
    @ValueSource(strings = {"GET", "HEAD"})
    void corsExposesTheActualFolderRateLimitRetryHeader(String method) throws Exception {
        CorsFilter cors = new CorsFilter(config.corsConfigurationSource("https://app.example.com"));
        ApiRateLimitFilter rateLimit = new ApiRateLimitFilter(true, 1, 1, 1, 100);
        for (int attempt = 0; attempt < 2; attempt++) {
            MockHttpServletRequest request = new MockHttpServletRequest(method, "/api/v2/workspaces/demo/rate-card-folders");
            request.addHeader("Origin", "https://app.example.com");
            MockHttpServletResponse response = new MockHttpServletResponse();

            cors.doFilter(request, response,
                    (incoming, outgoing) -> rateLimit.doFilter(incoming, outgoing, (ignoredRequest, ignoredResponse) -> {}));

            assertThat(response.getStatus()).isEqualTo(attempt == 0 ? 200 : 429);
            assertThat(response.getHeader("Access-Control-Allow-Origin")).isEqualTo("https://app.example.com");
            assertThat(response.getHeader("Access-Control-Expose-Headers")).contains("Location", "Retry-After");
            if (attempt == 1) {
                assertThat(Long.parseLong(response.getHeader("Retry-After"))).isBetween(1L, 60L);
                assertThat(response.getContentAsString()).contains("RATE_LIMIT_EXCEEDED");
            }
        }
    }
}
