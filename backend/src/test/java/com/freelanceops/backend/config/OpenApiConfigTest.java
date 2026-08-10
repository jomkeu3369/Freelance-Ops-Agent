package com.freelanceops.backend.config;

import static org.assertj.core.api.Assertions.assertThat;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.security.SecurityScheme;
import org.junit.jupiter.api.Test;

class OpenApiConfigTest {

    @Test
    void describesPublicApiAndBasicAuthentication() {
        OpenAPI openApi = new OpenApiConfig().publicApi();

        assertThat(openApi.getInfo().getTitle()).isEqualTo("Freelance Ops Agent API");
        assertThat(openApi.getInfo().getVersion()).isEqualTo("v1");

        SecurityScheme basicAuth = openApi.getComponents()
            .getSecuritySchemes()
            .get(OpenApiConfig.BASIC_AUTH_SCHEME);
        assertThat(basicAuth.getType()).isEqualTo(SecurityScheme.Type.HTTP);
        assertThat(basicAuth.getScheme()).isEqualTo("basic");
        assertThat(openApi.getSecurity().getFirst())
            .containsKey(OpenApiConfig.BASIC_AUTH_SCHEME);
    }
}
