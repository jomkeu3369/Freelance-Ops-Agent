package com.freelanceops.backend.integration;

import com.freelanceops.backend.domain.agentrun.client.AgentRunClient;
import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest;
import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest.*;
import com.freelanceops.backend.domain.agentrun.model.Provider;
import com.freelanceops.backend.domain.agentrun.model.ReasoningEffort;
import com.freelanceops.backend.domain.agentrun.repository.AgentRunRepository;
import com.freelanceops.backend.domain.agentrun.security.DelegationTokenIssuer;
import com.freelanceops.backend.domain.agentrun.service.AgentRunCommandDispatcher;
import com.freelanceops.backend.domain.agentrun.service.AgentRunCommandQueue;
import com.freelanceops.backend.domain.agentrun.service.AgentRunProjectionService;
import com.freelanceops.backend.domain.internaltool.security.DelegationTokenVerifier;
import com.freelanceops.backend.domain.project.repository.ProjectRepository;
import com.freelanceops.backend.domain.quotation.dto.request.*;
import com.freelanceops.backend.domain.quotation.dto.response.EstimationPolicyProposalResponse;
import com.freelanceops.backend.domain.quotation.service.EstimationPolicyProposalService;
import com.freelanceops.backend.domain.quotation.service.PricingConfigurationService;
import com.freelanceops.backend.domain.workspace.service.WorkspaceProvisioningService;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.*;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.web.server.ResponseStatusException;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.math.BigDecimal;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.security.KeyPairGenerator;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** Real Flyway/JPA/RBAC/security, with only the remote agent replaced by a loopback HTTP server. */
@Testcontainers(disabledWithoutDocker = true)
@SpringBootTest(properties = {
    "app.environment=test",
    "app.mcp.read-only.enabled=true",
    "app.auth.jwt-secret=synthetic-postgres-test-secret-at-least-32-bytes",
    "app.auth.issuer=postgres-test", "app.auth.audience=postgres-test-web",
    "agent.command-dispatch-enabled=false", "agent.reconciliation-enabled=false"
})
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
@Timeout(60)
class ChatPolicyMcpPostgresTest {
    @Container
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer(
        DockerImageName.parse("pgvector/pgvector:pg17").asCompatibleSubstituteFor("postgres"));

    private static HttpServer agent;
    private static final Map<UUID, String> agentViews = new ConcurrentHashMap<>();
    private static final AtomicInteger agentReads = new AtomicInteger();
    private static final AtomicInteger agentStarts = new AtomicInteger();
    private static final ObjectMapper wireMapper = new ObjectMapper();

    @DynamicPropertySource
    static void isolatedInfrastructure(DynamicPropertyRegistry registry) throws Exception {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.flyway.create-schemas", () -> true);
        registry.add("APP_BYOK_ENCRYPTION_KEY", () -> Base64.getEncoder().encodeToString(new byte[32]));
        registry.add("agent.delegation.previous-public-key", () -> "");
        registry.add("agent.delegation.previous-key-id", () -> "");
        // Ephemeral test-only signing keys. No credentials or external provider are involved.
        var generator = KeyPairGenerator.getInstance("RSA");
        generator.initialize(2048);
        var pair = generator.generateKeyPair();
        String publicKey = pem("PUBLIC KEY", pair.getPublic().getEncoded());
        registry.add("agent.delegation.private-key", () -> pem("PRIVATE KEY", pair.getPrivate().getEncoded()));
        registry.add("agent.delegation.public-key", () -> publicKey);
        registry.add("agent.delegation.key-id", () -> "postgres-test-key");
        registry.add("agent.delegation.issuer", () -> "postgres-test");
        var verifier = new DelegationTokenVerifier(publicKey, "postgres-test-key", "", "",
            "postgres-test", "freelance-ops-agent");
        agent = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        agent.createContext("/internal/v1/agent-runs", exchange -> {
            int status = 200;
            String output;
            try {
                String bearer = exchange.getRequestHeaders().getFirst("Authorization");
                if (bearer == null || !bearer.startsWith("Bearer ")) throw new IllegalArgumentException();
                var principal = verifier.verify(bearer.substring(7));
                if ("POST".equals(exchange.getRequestMethod())) {
                    JsonNode request = wireMapper.readTree(exchange.getRequestBody());
                    JsonNode context = request.path("context");
                    if (!principal.runId().toString().equals(context.path("runId").asText())
                        || !principal.workspaceId().toString().equals(context.path("workspaceId").asText())
                        || !principal.projectId().toString().equals(context.path("projectId").asText())) {
                        throw new IllegalArgumentException();
                    }
                    agentStarts.incrementAndGet();
                    output = wireMapper.writeValueAsString(Map.of("runId", principal.runId(),
                        "status", "QUEUED", "acceptedAt", Instant.now().toString()));
                } else {
                    UUID requested = UUID.fromString(exchange.getRequestURI().getPath()
                        .substring("/internal/v1/agent-runs/".length()));
                    if (!requested.equals(principal.runId())) throw new IllegalArgumentException();
                    agentReads.incrementAndGet();
                    output = agentViews.get(requested);
                    if (output == null) { status = 404; output = "{}"; }
                }
            } catch (RuntimeException error) {
                status = 401;
                output = "{}";
            }
            byte[] bytes = output.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(status, bytes.length);
            try (var stream = exchange.getResponseBody()) { stream.write(bytes); }
        });
        agent.start();
        registry.add("agent.base-url", () -> "http://127.0.0.1:" + agent.getAddress().getPort());
    }

    @AfterAll
    static void stopAgent() {
        if (agent != null) agent.stop(0);
        agentViews.clear();
    }

    @Autowired JdbcClient jdbc;
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @Autowired JwtEncoder tokens;
    @Autowired WorkspaceProvisioningService workspaces;
    @Autowired EstimationPolicyProposalService proposals;
    @Autowired PricingConfigurationService pricing;
    @Autowired AgentRunCommandQueue queue;
    @Autowired AgentRunRepository runs;
    @Autowired ProjectRepository projects;
    @Autowired AgentRunClient client;
    @Autowired DelegationTokenIssuer delegation;
    @Autowired AgentRunProjectionService projection;

    private UUID owner, workspace, project;

    @BeforeEach
    void fixture() {
        owner = user();
        workspace = workspaces.create(owner, "Synthetic chat fixture", "chat-" + UUID.randomUUID()).workspaceId();
        project = UUID.randomUUID();
        jdbc.sql("INSERT INTO app.project(id, workspace_id, title, requirement_text, currency, status, created_by) "
            + "VALUES (:id, :ws, 'Synthetic chat project', 'Original intake', 'KRW', 'LEAD', :owner)")
            .param("id", project).param("ws", workspace).param("owner", owner).update();
    }

    @Test
    void freshMigrationsReachV36AndEnableVector() {
        assertThat(jdbc.sql("SELECT count(*) FROM app.flyway_schema_history WHERE version = '36' AND success")
            .query(Long.class).single()).isEqualTo(1);
        assertThat(jdbc.sql("SELECT count(*) FROM pg_extension WHERE extname = 'vector'")
            .query(Long.class).single()).isEqualTo(1);
        assertThat(jdbc.sql("SELECT to_regclass('app.estimation_policy_proposal')::text")
            .query(String.class).single()).isEqualTo("app.estimation_policy_proposal");
    }

    @Test
    void authenticatedHttpProposalIsDurableAndOnlyConfirmationWritesPolicy() throws Exception {
        var request = change("0.10", UUID.randomUUID());
        mvc.perform(post(proposalPath()).contentType("application/json").content(mapper.writeValueAsString(request)))
            .andExpect(status().isUnauthorized());
        String body = mvc.perform(post(proposalPath()).header("Authorization", bearer(owner))
                .contentType("application/json").content(mapper.writeValueAsString(request)))
            .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("PENDING"))
            .andReturn().getResponse().getContentAsString();
        UUID id = UUID.fromString(mapper.readTree(body).path("proposalId").asText());
        var saved = proposals.get(owner, workspace, id);
        assertThat(policyCount()).isZero();
        assertThat(saved.sourceMessage()).isEqualTo(request.sourceMessage());
        assertThat(proposals.listRecent(owner, workspace, project)).extracting(EstimationPolicyProposalResponse::proposalId)
            .containsExactly(id);
        mvc.perform(post(proposalPath() + "/" + id + "/confirm").header("Authorization", bearer(owner))
                .contentType("application/json").content(mapper.writeValueAsString(
                    new ConfirmEstimationPolicyProposalRequest(saved.confirmationToken()))))
            .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("APPLIED"));
        var applied = proposals.get(owner, workspace, id);
        assertThat(applied.appliedAt()).isNotNull();
        assertThat(pricing.getPolicy(owner, workspace).defaultTaxRate()).isEqualByComparingTo("0.10");
        var repeated = confirm(applied);
        assertThat(repeated.appliedAt()).isEqualTo(applied.appliedAt());
        assertThat(repeated.after().version()).isEqualTo(applied.after().version());
        assertThat(policyCount()).isEqualTo(1);
    }

    @Test
    void creationRetryIsIdempotentButConflictingReuseCannotReplaceReviewedValues() {
        var request = change("0.10", UUID.randomUUID());
        var saved = proposals.propose(owner, workspace, request);
        assertThat(proposals.propose(owner, workspace, request).proposalId()).isEqualTo(saved.proposalId());
        rejects(409, () -> proposals.propose(owner, workspace, change("0.20", request.idempotencyKey())));
        assertThat(proposalCount()).isEqualTo(1);
        assertThat(proposals.get(owner, workspace, saved.proposalId()).after().defaultTaxRate())
            .isEqualByComparingTo("0.10");
    }

    @Test
    void incorrectTokenAndExpiredProposalCannotWritePolicy() {
        var saved = propose("0.10");
        rejects(403, () -> proposals.confirm(owner, workspace, saved.proposalId(),
            new ConfirmEstimationPolicyProposalRequest(UUID.randomUUID())));
        jdbc.sql("UPDATE app.estimation_policy_proposal SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 minute' WHERE id = :id")
            .param("id", saved.proposalId()).update();
        rejects(410, () -> confirm(saved));
        assertThat(proposals.get(owner, workspace, saved.proposalId()).status()).isEqualTo("PENDING");
        assertThat(policyCount()).isZero();
    }

    @Test
    void existingPutInvalidatesPendingProposalAndStaleCreation() {
        var saved = propose("0.10");
        pricing.updatePolicy(owner, workspace, new UpdateEstimationPolicyRequest(rate("0.20"), rate("0"), rate("0.30")));
        rejects(409, () -> confirm(saved));
        // Another update increments the actual JPA revision, even if rates subsequently match.
        pricing.updatePolicy(owner, workspace, new UpdateEstimationPolicyRequest(rate("0.25"), rate("0"), rate("0.30")));
        rejects(409, () -> proposals.propose(owner, workspace,
            new ProposeEstimationPolicyRequest(rate("0.10"), rate("0"), rate("0.30"), 0L,
                UUID.randomUUID(), project, "Stale reviewed settings")));
        assertThat(pricing.getPolicy(owner, workspace).defaultTaxRate()).isEqualByComparingTo("0.25");
        assertThat(proposals.get(owner, workspace, saved.proposalId()).status()).isEqualTo("PENDING");
    }

    @Test
    void concurrentConfirmationOfOneProposalAppliesOnce() throws Exception {
        pricing.updatePolicy(owner, workspace, new UpdateEstimationPolicyRequest(rate("0.02"), rate("0"), rate("0.30")));
        var saved = propose("0.10");
        var statuses = race(saved, saved);
        assertThat(statuses).containsExactlyInAnyOrder(200, 200);
        assertThat(pricing.getPolicy(owner, workspace).version()).isEqualTo(saved.before().version() + 1);
        assertThat(proposals.get(owner, workspace, saved.proposalId()).status()).isEqualTo("APPLIED");
    }

    @Test
    void concurrentDifferentReviewsCannotBothOverwriteTheSameRevision() throws Exception {
        pricing.updatePolicy(owner, workspace, new UpdateEstimationPolicyRequest(rate("0.02"), rate("0"), rate("0.30")));
        var first = propose("0.10");
        var second = propose("0.20");
        assertThat(race(first, second)).containsExactlyInAnyOrder(200, 409);
        assertThat(pricing.getPolicy(owner, workspace).version()).isEqualTo(first.before().version() + 1);
        assertThat(jdbc.sql("SELECT count(*) FROM app.estimation_policy_proposal WHERE workspace_id = :ws AND status = 'APPLIED'")
            .param("ws", workspace).query(Long.class).single()).isEqualTo(1);
    }

    @Test
    void proposalIsBoundToCreatorProjectWorkspaceAndWritePermission() {
        var saved = propose("0.10");
        UUID otherOwner = user();
        UUID otherWorkspace = workspaces.create(otherOwner, "Other synthetic tenant", "other-" + UUID.randomUUID()).workspaceId();
        rejects(404, () -> proposals.get(otherOwner, otherWorkspace, saved.proposalId()));
        rejects(404, () -> proposals.confirm(otherOwner, otherWorkspace, saved.proposalId(),
            new ConfirmEstimationPolicyProposalRequest(saved.confirmationToken())));
        // Even an OWNER in this workspace cannot confirm somebody else's reviewed proposal.
        member(otherOwner, "OWNER");
        rejects(404, () -> proposals.confirm(otherOwner, workspace, saved.proposalId(),
            new ConfirmEstimationPolicyProposalRequest(saved.confirmationToken())));
        UUID viewer = user();
        member(viewer, "VIEWER");
        rejects(403, () -> proposals.propose(viewer, workspace, change("0.20", UUID.randomUUID())));
        rejects(404, () -> proposals.propose(otherOwner, otherWorkspace,
            new ProposeEstimationPolicyRequest(rate("0.20"), rate("0"), rate("0.30"), 0L,
                UUID.randomUUID(), project, "Foreign project settings")));
        assertThat(policyCount()).isZero();
    }

    @Test
    void mcpUsesRealAuthenticationAndTenantScopedDatabaseReadsWithoutChangingBusinessRows() throws Exception {
        var pending = propose("0.10");
        String projectBefore = projectSnapshot();
        var request = mcp(workspace, null, "tools/call", "get_project", Map.of("projectId", project));
        mvc.perform(request).andExpect(status().isUnauthorized());
        mvc.perform(mcp(workspace, "Bearer invalid", "tools/list", null, Map.of())).andExpect(status().isUnauthorized());
        mvc.perform(mcp(workspace, bearer(owner), "server/discover", null, Map.of())).andExpect(status().isOk());
        mvc.perform(mcp(workspace, bearer(owner), "tools/call", "get_project", Map.of("projectId", project)))
            .andExpect(status().isOk()).andExpect(jsonPath("$.result.structuredContent.id").value(project.toString()))
            .andExpect(jsonPath("$.result.structuredContent.title").value("Synthetic chat project"));
        mvc.perform(mcp(workspace, bearer(owner), "tools/call", "list_projects", Map.of()))
            .andExpect(status().isOk()).andExpect(jsonPath("$.result.structuredContent.projects[0].id").value(project.toString()));
        mvc.perform(mcp(workspace, bearer(owner), "tools/call", "update_project", Map.of()))
            .andExpect(status().isBadRequest());
        assertThat(projectSnapshot()).isEqualTo(projectBefore);
        assertThat(policyCount()).isZero();
        assertThat(proposals.get(owner, workspace, pending.proposalId()).status()).isEqualTo("PENDING");
    }

    @Test
    void mcpDiscoveryReflectsPermissionsAndCannotReadAnotherTenantsProject() throws Exception {
        UUID viewer = user();
        member(viewer, "VIEWER");
        mvc.perform(mcp(workspace, bearer(viewer), "tools/list", null, Map.of()))
            .andExpect(status().isOk()).andExpect(jsonPath("$.result.tools.length()").value(2));
        mvc.perform(mcp(workspace, bearer(owner), "tools/list", null, Map.of()))
            .andExpect(status().isOk()).andExpect(jsonPath("$.result.tools.length()").value(4));
        int readsBefore = agentReads.get();
        mvc.perform(mcp(workspace, bearer(viewer), "tools/call", "get_project_progress", Map.of("projectId", project)))
            .andExpect(status().isForbidden());
        jdbc.sql("DELETE FROM app.role_permission WHERE workspace_id = :ws AND permission_code = 'project.read' "
                + "AND role_id IN (SELECT id FROM app.workspace_role WHERE workspace_id = :ws AND code = 'VIEWER')")
            .param("ws", workspace).update();
        mvc.perform(mcp(workspace, bearer(viewer), "tools/list", null, Map.of()))
            .andExpect(status().isOk()).andExpect(jsonPath("$.result.tools.length()").value(0));
        mvc.perform(mcp(workspace, bearer(viewer), "tools/call", "get_project", Map.of("projectId", project)))
            .andExpect(status().isForbidden());
        UUID foreignOwner = user();
        UUID foreignWorkspace = workspaces.create(foreignOwner, "Foreign tenant", "foreign-" + UUID.randomUUID()).workspaceId();
        mvc.perform(mcp(workspace, bearer(foreignOwner), "tools/list", null, Map.of())).andExpect(status().isNotFound());
        mvc.perform(mcp(foreignWorkspace, bearer(foreignOwner), "tools/call", "get_project", Map.of("projectId", project)))
            .andExpect(status().isNotFound());
        mvc.perform(mcp(workspace, bearer(owner), "tools/call", "get_project",
                Map.of("projectId", project, "workspaceId", foreignWorkspace)))
            .andExpect(status().isBadRequest());
        assertThat(agentReads.get()).isEqualTo(readsBefore);
    }

    @Test
    void chatInputOutboxAndMcpResultAreLinkedToTheSameRealRun() throws Exception {
        var input = new StartAgentRunRequest("Review this synthetic project", "en-US", "KR",
            new ModelSelection(Provider.OPENAI, "synthetic-model", ReasoningEffort.LOW),
            new RunBudget(30, 0, 0, 0, 0, 1, 1, 0, 0, 0),
            new SafetyContext(false, false, false, false, false, false, true));
        String response = mvc.perform(post(runPath()).header("Authorization", bearer(owner))
                .contentType("application/json").content(mapper.writeValueAsString(input)))
            .andExpect(status().isAccepted()).andReturn().getResponse().getContentAsString();
        UUID runId = UUID.fromString(mapper.readTree(response).path("runId").asText());
        int startsBefore = agentStarts.get();
        // Scheduling stays disabled. This explicit dispatcher sends only this disposable test DB's outbox.
        new AgentRunCommandDispatcher(queue, runs, projects, client, delegation, projection, mapper).dispatchPending();
        assertThat(agentStarts.get()).isEqualTo(startsBefore + 1);
        assertThat(jdbc.sql("SELECT status FROM app.agent_run_command WHERE run_id = :run AND command_type = 'START'")
            .param("run", runId).query(String.class).single()).isEqualTo("COMPLETED");
        agentViews.put(runId, mapper.writeValueAsString(Map.of("runId", runId, "status", "COMPLETED",
            "result", Map.of("projectSummary", "Synthetic result", "departmentResults", List.of()),
            "updatedAt", Instant.now().toString())));
        String runBefore = runSnapshot(runId);
        mvc.perform(mcp(workspace, bearer(owner), "tools/call", "get_project_result", Map.of("projectId", project)))
            .andExpect(status().isOk()).andExpect(jsonPath("$.result.structuredContent.runId").value(runId.toString()))
            .andExpect(jsonPath("$.result.structuredContent.result.projectSummary").value("Synthetic result"))
            .andExpect(jsonPath("$.result.structuredContent.metadata").doesNotExist());
        mvc.perform(mcp(workspace, bearer(owner), "tools/call", "get_project_progress", Map.of("projectId", project)))
            .andExpect(status().isOk()).andExpect(jsonPath("$.result.structuredContent.run.runId").value(runId.toString()))
            .andExpect(jsonPath("$.result.structuredContent.run.status").value("COMPLETED"));
        assertThat(runSnapshot(runId)).isEqualTo(runBefore);
        // The regular workspace GET still performs the existing explicit synchronization.
        mvc.perform(get("/api/v2/workspaces/" + workspace + "/agent-runs/" + runId)
                .header("Authorization", bearer(owner)))
            .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("COMPLETED"));
        assertThat(jdbc.sql("SELECT status FROM app.agent_run WHERE id = :run AND workspace_id = :ws AND project_id = :project")
            .param("run", runId).param("ws", workspace).param("project", project).query(String.class).single())
            .isEqualTo("COMPLETED");
        mvc.perform(get(runPath() + "/history").header("Authorization", bearer(owner)))
            .andExpect(status().isOk()).andExpect(jsonPath("$[0].runId").value(runId.toString()))
            .andExpect(jsonPath("$[0].requirementText").value(input.requirementText()))
            .andExpect(jsonPath("$[0].status").value("COMPLETED"));
        UUID viewer = user();
        member(viewer, "VIEWER");
        mvc.perform(get(runPath() + "/history").header("Authorization", bearer(viewer)))
            .andExpect(status().isForbidden());
        mvc.perform(get(runPath() + "/history").header("Authorization", bearer(user())))
            .andExpect(status().isNotFound());
    }

    private List<Integer> race(EstimationPolicyProposalResponse first, EstimationPolicyProposalResponse second) throws Exception {
        var ready = new CountDownLatch(2);
        var start = new CountDownLatch(1);
        try (var executor = Executors.newFixedThreadPool(2)) {
            List<Future<Integer>> futures = new ArrayList<>();
            for (var proposal : List.of(first, second)) futures.add(executor.submit(() -> {
                ready.countDown();
                if (!start.await(15, TimeUnit.SECONDS)) throw new IllegalStateException("race start timed out");
                try { confirm(proposal); return 200; }
                catch (ResponseStatusException error) { return error.getStatusCode().value(); }
            }));
            try { assertThat(ready.await(15, TimeUnit.SECONDS)).isTrue(); }
            finally { start.countDown(); }
            return List.of(futures.get(0).get(15, TimeUnit.SECONDS), futures.get(1).get(15, TimeUnit.SECONDS));
        }
    }

    private EstimationPolicyProposalResponse propose(String tax) {
        return proposals.propose(owner, workspace, change(tax, UUID.randomUUID()));
    }
    private ProposeEstimationPolicyRequest change(String tax, UUID key) {
        return new ProposeEstimationPolicyRequest(rate(tax), rate("0"), rate("0.30"),
            pricing.getPolicy(owner, workspace).version(), key, project, "Reviewed tax " + tax);
    }
    private EstimationPolicyProposalResponse confirm(EstimationPolicyProposalResponse proposal) {
        return proposals.confirm(owner, workspace, proposal.proposalId(),
            new ConfirmEstimationPolicyProposalRequest(proposal.confirmationToken()));
    }
    private static void rejects(int status, org.assertj.core.api.ThrowableAssert.ThrowingCallable call) {
        assertThatThrownBy(call).isInstanceOfSatisfying(ResponseStatusException.class,
            error -> assertThat(error.getStatusCode().value()).isEqualTo(status));
    }
    private UUID user() {
        UUID id = UUID.randomUUID();
        jdbc.sql("INSERT INTO app.user_account(id, external_subject, email, status) VALUES (:id, :subject, :email, 'ACTIVE')")
            .param("id", id).param("subject", "synthetic-" + id).param("email", id + "@example.invalid").update();
        return id;
    }
    private void member(UUID user, String role) {
        UUID membership = UUID.randomUUID();
        UUID roleId = jdbc.sql("SELECT id FROM app.workspace_role WHERE workspace_id = :ws AND code = :role")
            .param("ws", workspace).param("role", role).query(UUID.class).single();
        jdbc.sql("INSERT INTO app.workspace_member(id, workspace_id, user_id, status, joined_at) VALUES (:id, :ws, :user, 'ACTIVE', CURRENT_TIMESTAMP)")
            .param("id", membership).param("ws", workspace).param("user", user).update();
        jdbc.sql("INSERT INTO app.member_role(workspace_id, membership_id, role_id, assigned_by) VALUES (:ws, :member, :role, :owner)")
            .param("ws", workspace).param("member", membership).param("role", roleId).param("owner", owner).update();
    }
    private long policyCount() {
        return jdbc.sql("SELECT count(*) FROM app.estimation_policy WHERE workspace_id = :ws")
            .param("ws", workspace).query(Long.class).single();
    }
    private long proposalCount() {
        return jdbc.sql("SELECT count(*) FROM app.estimation_policy_proposal WHERE workspace_id = :ws")
            .param("ws", workspace).query(Long.class).single();
    }
    private String projectSnapshot() {
        return jdbc.sql("SELECT row_to_json(p)::text FROM app.project p WHERE id = :id")
            .param("id", project).query(String.class).single();
    }
    private String runSnapshot(UUID runId) {
        return jdbc.sql("SELECT row_to_json(r)::text FROM app.agent_run r WHERE id = :id")
            .param("id", runId).query(String.class).single();
    }
    private String proposalPath() { return "/api/v2/workspaces/" + workspace + "/estimation-policy/proposals"; }
    private String runPath() { return "/api/v2/workspaces/" + workspace + "/projects/" + project + "/agent-runs"; }
    private String bearer(UUID user) {
        Instant now = Instant.now();
        var claims = JwtClaimsSet.builder().issuer("postgres-test").subject(user.toString())
            .audience(List.of("postgres-test-web")).issuedAt(now).expiresAt(now.plusSeconds(120))
            .claim("token_type", "access").build();
        return "Bearer " + tokens.encode(JwtEncoderParameters.from(
            JwsHeader.with(MacAlgorithm.HS256).type("JWT").build(), claims)).getTokenValue();
    }
    private MockHttpServletRequestBuilder mcp(UUID ws, String authorization, String method, String tool, Map<String, ?> arguments) {
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("_meta", Map.of("io.modelcontextprotocol/protocolVersion", "2026-07-28",
            "io.modelcontextprotocol/clientCapabilities", Map.of()));
        if (tool != null) { params.put("name", tool); params.put("arguments", arguments); }
        var request = post("/api/v2/workspaces/{workspaceId}/mcp", ws).contentType("application/json")
            .accept("application/json", "text/event-stream").header("MCP-Protocol-Version", "2026-07-28")
            .header("Mcp-Method", method).content(mapper.writeValueAsString(
                Map.of("jsonrpc", "2.0", "id", 1, "method", method, "params", params)));
        if (tool != null) request.header("Mcp-Name", tool);
        if (authorization != null) request.header("Authorization", authorization);
        return request;
    }
    private static BigDecimal rate(String value) { return new BigDecimal(value); }
    private static String pem(String kind, byte[] bytes) {
        return "-----BEGIN " + kind + "-----\n" + Base64.getMimeEncoder(64, new byte[]{'\n'}).encodeToString(bytes)
            + "\n-----END " + kind + "-----";
    }
}
