package com.freelanceops.backend.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.web.authentication.www.BasicAuthenticationFilter;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.client.RestClient;

import com.freelanceops.backend.internaltool.security.DelegationTokenFilter;

@Configuration
@EnableMethodSecurity
public class SecurityConfig {

    @Bean
    RestClient.Builder restClientBuilder() {
        return RestClient.builder();
    }

    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http, DelegationTokenFilter delegationTokenFilter) throws Exception {
        return http
            .csrf(csrf -> csrf.disable())
            .authorizeHttpRequests(authorize -> authorize
                .requestMatchers("/actuator/health/**").permitAll()
                .requestMatchers("/swagger-ui.html", "/swagger-ui/**", "/v3/api-docs/**").permitAll()
                .requestMatchers("/internal/v1/**").permitAll()
                .anyRequest().authenticated()
            )
            .addFilterBefore(delegationTokenFilter, BasicAuthenticationFilter.class)
            .httpBasic(Customizer.withDefaults())
            .build();
    }
}
