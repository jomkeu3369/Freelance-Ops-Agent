package com.freelanceops.backend.global.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.annotation.Order;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.client.RestClient;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import com.freelanceops.backend.domain.internaltool.security.DelegationTokenFilter;
import com.freelanceops.backend.global.security.ApiRateLimitFilter;

import java.util.Arrays;
import java.util.List;

@Configuration
@EnableWebSecurity
@EnableMethodSecurity
public class SecurityConfig {

    @Bean
    RestClient.Builder restClientBuilder() {
        return RestClient.builder();
    }

    @Bean
    @Order(1)
    SecurityFilterChain internalToolSecurityFilterChain(HttpSecurity http, DelegationTokenFilter delegationTokenFilter) throws Exception {
        return http
            .securityMatcher("/internal/v1/**")
            .csrf(csrf -> csrf.disable())
            .authorizeHttpRequests(authorize -> authorize.anyRequest().permitAll())
            .addFilterBefore(
                delegationTokenFilter,
                org.springframework.security.web.authentication.AnonymousAuthenticationFilter.class
            )
            .build();
    }

    @Bean
    FilterRegistrationBean<DelegationTokenFilter> delegationTokenFilterRegistration(DelegationTokenFilter delegationTokenFilter) {
        FilterRegistrationBean<DelegationTokenFilter> registration = new FilterRegistrationBean<>(delegationTokenFilter);
        registration.setEnabled(false);
        return registration;
    }

    @Bean
    FilterRegistrationBean<ApiRateLimitFilter> apiRateLimitFilterRegistration(ApiRateLimitFilter apiRateLimitFilter) {
        FilterRegistrationBean<ApiRateLimitFilter> registration = new FilterRegistrationBean<>(apiRateLimitFilter);
        registration.setEnabled(false);
        return registration;
    }

    @Bean
    @Order(2)
    SecurityFilterChain publicApiSecurityFilterChain(HttpSecurity http, ApiRateLimitFilter rateLimitFilter, JwtDecoder authJwtDecoder) throws Exception {
        return http
            .csrf(csrf -> csrf.disable())
            .cors(Customizer.withDefaults())
            .authorizeHttpRequests(authorize -> authorize
                .requestMatchers("/actuator/health/**").permitAll()
                .requestMatchers("/actuator/metrics/**").denyAll()
                .requestMatchers("/swagger-ui.html", "/swagger-ui/**", "/v3/api-docs/**").permitAll()
                .requestMatchers("/api/v2/auth/**").permitAll()
                .requestMatchers("/api/v2/proposals/**").permitAll()
                .anyRequest().authenticated()
            )
            .addFilterAfter(rateLimitFilter, org.springframework.security.oauth2.server.resource.web.authentication.BearerTokenAuthenticationFilter.class)
            .oauth2ResourceServer(oauth2 -> oauth2.jwt(jwt -> jwt.decoder(authJwtDecoder)))
            .build();
    }

    @Bean
    CorsConfigurationSource corsConfigurationSource(
        @Value("${app.cors.allowed-origins:http://localhost:3000,http://localhost:5173}") String configuredOrigins
    ) {
        List<String> origins = Arrays.stream(configuredOrigins.split(","))
            .map(String::trim)
            .filter(origin -> !origin.isBlank())
            .distinct()
            .toList();
        if (origins.isEmpty()) {
            throw new IllegalStateException("APP_CORS_ALLOWED_ORIGINS must contain at least one exact origin");
        }
        if (origins.stream().anyMatch(origin -> "*".equals(origin) || !origin.matches("https?://[^/]+"))) {
            throw new IllegalStateException("CORS origins must be exact http or https origins without paths or wildcards");
        }

        CorsConfiguration configuration = new CorsConfiguration();
        configuration.setAllowedOrigins(origins);
        configuration.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        configuration.setAllowedHeaders(List.of("Authorization", "Content-Type", "Accept", "Last-Event-ID", "traceparent"));
        configuration.setExposedHeaders(List.of("Location"));
        configuration.setAllowCredentials(false);
        configuration.setMaxAge(3600L);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/api/**", configuration);
        return source;
    }
}


