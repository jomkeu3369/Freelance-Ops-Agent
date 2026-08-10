package com.freelanceops.backend.config;

import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Contact;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.security.SecurityRequirement;
import io.swagger.v3.oas.models.security.SecurityScheme;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration(proxyBeanMethods = false)
public class OpenApiConfig {

    static final String BASIC_AUTH_SCHEME = "basicAuth";

    @Bean
    OpenAPI publicApi() {
        return new OpenAPI()
            .info(new Info()
                .title("Freelance Ops Agent API")
                .description("브라우저와 외부 클라이언트가 호출하는 Spring Boot 공개 API")
                .version("v1")
                .contact(new Contact().name("Freelance Ops Agent")))
            .components(new Components().addSecuritySchemes(
                BASIC_AUTH_SCHEME,
                new SecurityScheme()
                    .type(SecurityScheme.Type.HTTP)
                    .scheme("basic")
            ))
            .addSecurityItem(new SecurityRequirement().addList(BASIC_AUTH_SCHEME));
    }
}
