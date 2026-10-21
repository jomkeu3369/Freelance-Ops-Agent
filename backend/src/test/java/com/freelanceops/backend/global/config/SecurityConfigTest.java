package com.freelanceops.backend.global.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.DefaultCorsProcessor;

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
}
