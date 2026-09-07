package com.freelanceops.backend.global.health;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.DockerClientFactory;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

import java.time.Duration;
import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@Testcontainers(disabledWithoutDocker = true)
@SpringBootTest
@AutoConfigureMockMvc
class DatabaseReadinessPostgresTest {

    @Container
    private static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer(
        DockerImageName.parse("pgvector/pgvector:pg17").asCompatibleSubstituteFor("postgres")
    );

    @Autowired
    private MockMvc mvc;

    @DynamicPropertySource
    static void databaseProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.flyway.create-schemas", () -> true);
        registry.add("agent.command-dispatch-enabled", () -> false);
        registry.add("agent.reconciliation-enabled", () -> false);
    }

    @Test
    void databaseOutageFailsReadinessButNotLivenessAndRecovers() throws Exception {
        mvc.perform(get("/actuator/health/readiness"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("UP"));

        var docker = DockerClientFactory.instance().client();
        docker.pauseContainerCmd(POSTGRES.getContainerId()).exec();
        try {
            Instant started = Instant.now();
            mvc.perform(get("/actuator/health/readiness"))
                .andExpect(status().isServiceUnavailable()).andExpect(jsonPath("$.status").value("DOWN"))
                .andExpect(jsonPath("$.components").doesNotExist());
            assertThat(Duration.between(started, Instant.now())).isLessThan(Duration.ofSeconds(5));
            mvc.perform(get("/actuator/health/liveness"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("UP"));
        } finally {
            docker.unpauseContainerCmd(POSTGRES.getContainerId()).exec();
        }

        mvc.perform(get("/actuator/health/readiness"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("UP"));
    }
}
