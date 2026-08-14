package com.freelanceops.backend.global.config;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class SecurityConfigTest {

    private final SecurityConfig config = new SecurityConfig();

    @Test
    void corsUsesOnlyExplicitBrowserOriginsAndBearerHeaders() {
        CorsConfigurationSource source = config.corsConfigurationSource(
            "http://localhost:3000, https://preview.example.com, http://localhost:3000"
        );
        MockHttpServletRequest request = new MockHttpServletRequest("OPTIONS", "/api/v2/auth/login");
        CorsConfiguration cors = source.getCorsConfiguration(request);

        assertThat(cors).isNotNull();
        assertThat(cors.getAllowedOrigins()).containsExactly("http://localhost:3000", "https://preview.example.com");
        assertThat(cors.getAllowedOrigins()).doesNotContain("*");
        assertThat(cors.getAllowedHeaders()).contains("Authorization", "Last-Event-ID", "traceparent");
        assertThat(cors.getAllowCredentials()).isFalse();
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
