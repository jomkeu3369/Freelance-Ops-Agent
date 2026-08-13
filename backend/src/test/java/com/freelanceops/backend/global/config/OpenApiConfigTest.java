package com.freelanceops.backend.global.config;

import static org.assertj.core.api.Assertions.assertThat;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.security.SecurityScheme;
import org.junit.jupiter.api.Test;

class OpenApiConfigTest {

    @Test
    void describesPublicApiAndBearerAuthentication() {
        OpenAPI openApi = new OpenApiConfig().publicApi();

        assertThat(openApi.getInfo().getTitle()).isEqualTo("Freelance Ops Agent API");
        assertThat(openApi.getInfo().getVersion()).isEqualTo("v2");

        SecurityScheme bearerAuth = openApi.getComponents()
            .getSecuritySchemes()
            .get(OpenApiConfig.BEARER_AUTH_SCHEME);
        assertThat(bearerAuth.getType()).isEqualTo(SecurityScheme.Type.HTTP);
        assertThat(bearerAuth.getScheme()).isEqualTo("bearer");
        assertThat(bearerAuth.getBearerFormat()).isEqualTo("JWT");
        assertThat(openApi.getSecurity().getFirst())
            .containsKey(OpenApiConfig.BEARER_AUTH_SCHEME);
    }
}


