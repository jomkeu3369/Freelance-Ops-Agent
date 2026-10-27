package com.freelanceops.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.freelanceops.backend.domain.client.dto.request.CreateClientRequest;
import com.freelanceops.backend.domain.client.service.ClientService;
import com.freelanceops.backend.domain.workspace.service.WorkspaceProvisioningService;

import org.hibernate.resource.jdbc.spi.StatementInspector;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

@Testcontainers(disabledWithoutDocker = true)
@SpringBootTest(properties = {
    "app.environment=test",
    "spring.flyway.create-schemas=true",
    "agent.command-dispatch-enabled=false",
    "agent.task-command-dispatch-enabled=false",
    "agent.reconciliation-enabled=false",
    "app.rate-limit.enabled=false",
    "spring.jpa.properties.hibernate.session_factory.statement_inspector=com.freelanceops.backend.integration.ClientConcurrencyPostgresTest$ConcurrentUpdates"
})
@AutoConfigureMockMvc
@Timeout(90)
public class ClientConcurrencyPostgresTest {
    @Container
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer(
            DockerImageName.parse("pgvector/pgvector:pg17").asCompatibleSubstituteFor("postgres"));

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired ClientService clients;
    @Autowired WorkspaceProvisioningService workspaces;
    @Autowired JdbcTemplate jdbc;
    @Autowired MockMvc mvc;
    private UUID user;
    private UUID workspace;
    private UUID client;
    private long version;

    public static class ConcurrentUpdates implements StatementInspector {
        static final AtomicReference<CountDownLatch> barrier = new AtomicReference<>();

        @Override
        public String inspect(String sql) {
            CountDownLatch waiting = barrier.get();
            if (waiting != null && sql.toLowerCase().startsWith("update app.client ")) {
                waiting.countDown();
                try {
                    if (!waiting.await(20, TimeUnit.SECONDS)) throw new IllegalStateException("both updates did not reach the database");
                } catch (InterruptedException error) {
                    Thread.currentThread().interrupt();
                    throw new IllegalStateException(error);
                }
            }
            return sql;
        }
    }

    @BeforeEach
    void setup() {
        user = UUID.randomUUID();
        jdbc.update("INSERT INTO app.user_account(id,external_subject,email,status) VALUES (?,?,?,'ACTIVE')", user, user.toString(), user + "@example.invalid");
        workspace = workspaces.create(user, "Client fixture", "client-" + UUID.randomUUID()).workspaceId();
        var created = clients.create(user, workspace, new CreateClientRequest("Original", null, null, null, "Initial"));
        client = created.id();
        version = created.version();
    }

    @Test
    void missingInvalidAndStaleVersionsCannotOverwriteSavedData() throws Exception {
        String path = "/api/v2/workspaces/" + workspace + "/clients/" + client;
        for (String body : List.of("{\"name\":\"No version\"}", "{\"name\":\"Negative\",\"expectedVersion\":-1}")) {
            mvc.perform(patch(path).with(jwt().jwt(token -> token.subject(user.toString())))
                            .contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isBadRequest());
        }
        mvc.perform(patch(path).with(jwt().jwt(token -> token.subject(user.toString())))
                        .contentType(MediaType.APPLICATION_JSON).content(body("First", version)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.version").value(version + 1));
        mvc.perform(patch(path).with(jwt().jwt(token -> token.subject(user.toString())))
                        .contentType(MediaType.APPLICATION_JSON).content(body("Stale", version)))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("CONCURRENT_MODIFICATION"));
        assertThat(clients.get(user, workspace, client).name()).isEqualTo("First");
    }

    @Test
    void overlappingUpdatesWithTheSameVersionHaveExactlyOneWinner() throws Exception {
        String path = "/api/v2/workspaces/" + workspace + "/clients/" + client;
        ConcurrentUpdates.barrier.set(new CountDownLatch(2));
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var first = executor.submit(() -> patchStatus(path, "First"));
            var second = executor.submit(() -> patchStatus(path, "Second"));
            assertThat(List.of(first.get(30, TimeUnit.SECONDS), second.get(30, TimeUnit.SECONDS))).containsExactlyInAnyOrder(200, 409);
        } finally {
            ConcurrentUpdates.barrier.set(null);
        }
        var saved = clients.get(user, workspace, client);
        assertThat(saved.name()).isIn("First", "Second");
        assertThat(saved.version()).isEqualTo(version + 1);
    }

    @Test
    void anArchivedClientCannotBeChangedWithAnEarlierVersion() throws Exception {
        clients.archive(user, workspace, client);
        String path = "/api/v2/workspaces/" + workspace + "/clients/" + client;
        mvc.perform(patch(path).with(jwt().jwt(token -> token.subject(user.toString())))
                        .contentType(MediaType.APPLICATION_JSON).content(body("Stale", version)))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("CONCURRENT_MODIFICATION"));
        var saved = clients.get(user, workspace, client);
        assertThat(saved.name()).isEqualTo("Original");
        assertThat(saved.status().name()).isEqualTo("ARCHIVED");
    }

    private int patchStatus(String path, String name) throws Exception {
        return mvc.perform(patch(path).with(jwt().jwt(token -> token.subject(user.toString())))
                        .contentType(MediaType.APPLICATION_JSON).content(body(name, version)))
                .andReturn().getResponse().getStatus();
    }

    private static String body(String name, long expectedVersion) {
        return "{\"name\":\"" + name + "\",\"notes\":\"saved\",\"expectedVersion\":" + expectedVersion + "}";
    }
}
