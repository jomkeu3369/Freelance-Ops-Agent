package com.freelanceops.backend.integration;

import com.freelanceops.backend.domain.agentrun.client.AttachmentReaderClient;
import com.freelanceops.backend.domain.agentrun.client.dto.request.InternalAgentRunRequest;
import com.freelanceops.backend.domain.agentrun.dto.AttachmentText;
import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest;
import com.freelanceops.backend.domain.agentrun.dto.response.StartAgentRunResponse;
import com.freelanceops.backend.domain.agentrun.model.Provider;
import com.freelanceops.backend.domain.agentrun.model.ReasoningEffort;
import com.freelanceops.backend.domain.agentrun.service.AgentRunGatewayService;
import com.freelanceops.backend.domain.agentrun.service.ChatAttachmentService;
import com.freelanceops.backend.domain.project.model.ProjectDeletionInProgressException;
import com.freelanceops.backend.domain.workspace.service.WorkspaceProvisioningService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.client.RestClientException;
import org.springframework.web.server.ResponseStatusException;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;
import tools.jackson.databind.ObjectMapper;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.doThrow;

/** V45 and real transaction boundaries; synthetic inputs, no provider/network calls. */
@Testcontainers(disabledWithoutDocker = true)
@SpringBootTest(properties = {
    "app.environment=test", "spring.flyway.create-schemas=true", "platform.ai.spend.enabled=true",
    "agent.command-dispatch-enabled=false", "agent.task-command-dispatch-enabled=false",
    "agent.reconciliation-enabled=false", "app.notices.dispatch-enabled=false"
})
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
@Timeout(60)
class ChatAttachmentPostgresTest {
    private static final int MIB = 1024 * 1024;
    private static final byte[] ORIGINAL = "synthetic-original-bytes-not-the-extraction".getBytes(StandardCharsets.UTF_8);
    private static final String EXTRACTED = "Synthetic extracted reference";
    private static final KeyPair SIGNING_KEYS = signingKeys();

    @Container
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer(
        DockerImageName.parse("pgvector/pgvector:pg17").asCompatibleSubstituteFor("postgres"));

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        // Ephemeral test-only keys keep the real token issuer in the upload path.
        registry.add("agent.delegation.private-key", () -> Base64.getEncoder().encodeToString(SIGNING_KEYS.getPrivate().getEncoded()));
        registry.add("agent.delegation.public-key", () -> Base64.getEncoder().encodeToString(SIGNING_KEYS.getPublic().getEncoded()));
    }

    @Autowired ChatAttachmentService attachments;
    @Autowired AgentRunGatewayService gateway;
    @Autowired WorkspaceProvisioningService workspaces;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper mapper;
    @Autowired PlatformTransactionManager transactionManager;
    @MockitoBean AttachmentReaderClient reader;

    private TransactionTemplate tx;
    private Scope scope;

    @BeforeEach
    void setup() {
        tx = new TransactionTemplate(transactionManager);
        scope = workspace(account());
        doAnswer(invocation -> {
            AttachmentReaderClient.Input input = invocation.getArgument(0);
            return extraction(input.file().name(), ORIGINAL.length, EXTRACTED);
        }).when(reader).read(any(), anyString());
    }

    @Test
    void uploadPersistsOnlyScopedExtractionAndThirtyMinuteExpiry() {
        Instant before = Instant.now();
        var preview = upload(scope);
        Instant after = Instant.now();

        assertThat(preview.expiresAt()).isBetween(before.plusSeconds(1800), after.plusSeconds(1800));
        var row = jdbc.queryForMap("SELECT * FROM app.chat_attachment WHERE id = ?", preview.id());
        assertThat(row.keySet()).containsExactlyInAnyOrder("id", "workspace_id", "project_id", "owner_id", "payload", "expires_at");
        assertThat(row).containsEntry("owner_id", scope.user()).containsEntry("workspace_id", scope.workspace())
            .containsEntry("project_id", scope.project());
        String payload = jdbc.queryForObject("SELECT payload::text FROM app.chat_attachment WHERE id = ?", String.class, preview.id());
        assertThat(mapper.readValue(payload, AttachmentText.class)).isEqualTo(preview.extraction());
        assertNoOriginal(payload);
        assertThat(jdbc.queryForObject("SELECT expires_at FROM app.chat_attachment WHERE id = ?", Timestamp.class, preview.id()).toInstant())
            .isBetween(preview.expiresAt().minusNanos(1000), preview.expiresAt().plusNanos(1000));
        assertThat(attachments.resolve(scope.user(), scope.workspace(), scope.project(), List.of(preview.id())))
            .containsExactly(preview.extraction());
        assertThat(count(scope.user())).isOne(); // Reading a preview never consumes it.
        assertNoStart(scope);

        var input = ArgumentCaptor.forClass(AttachmentReaderClient.Input.class);
        verify(reader).read(input.capture(), anyString());
        assertThat(input.getValue().file().base64()).isEqualTo(Base64.getEncoder().encodeToString(ORIGINAL));
        assertThat(input.getValue().context().workspaceId()).isEqualTo(scope.workspace());
        assertThat(input.getValue().context().projectId()).isEqualTo(scope.project());
        assertThat(input.getValue().context().initiatedBy()).isEqualTo(scope.user());
        assertThat(input.getValue().context().effectivePermissions()).contains("agent.run", "project.read");
    }

    @Test
    void migrationRejectsCrossWorkspaceProjectAndOversizedPayloadAndCascadesProjectDeletion() {
        Scope otherWorkspace = workspace(scope.user());
        assertThatThrownBy(() -> insert(scope.user(), otherWorkspace.workspace(), scope.project(),
            extraction("data.txt", 1, "reference"))).isInstanceOf(DataAccessException.class);
        assertThatThrownBy(() -> jdbc.update("""
            INSERT INTO app.chat_attachment(id, workspace_id, project_id, owner_id, payload, expires_at)
            VALUES (?, ?, ?, ?, ?::jsonb, CURRENT_TIMESTAMP + INTERVAL '30 minutes')
            """, UUID.randomUUID(), scope.workspace(), scope.project(), scope.user(),
            "{\"text\":\"" + "x".repeat(500001) + "\"}"))
            .isInstanceOf(DataAccessException.class);
        assertThat(count(scope.user())).isZero();

        UUID deleted = upload(scope).id();
        UUID retained = upload(otherWorkspace).id();
        jdbc.update("DELETE FROM app.project WHERE id = ?", scope.project());
        assertThat(exists(deleted)).isFalse();
        assertThat(exists(retained)).isTrue();
    }

    @Test
    void failedExtractionNeverLeavesStagingOrLeaksReaderError() {
        doThrow(new RestClientException("synthetic private parser response")).when(reader).read(any(), anyString());
        assertThatThrownBy(() -> upload(scope)).isInstanceOfSatisfying(ResponseStatusException.class, error -> {
            assertThat(error.getStatusCode().value()).isEqualTo(422);
            assertThat(error.getReason()).doesNotContain("synthetic private parser response");
        });
        assertThat(count(scope.user())).isZero();
        assertNoStart(scope);
    }

    @Test
    void uploadParticipatesInCallerRollback() {
        AtomicReference<UUID> id = new AtomicReference<>();
        assertThatThrownBy(() -> tx.executeWithoutResult(status -> {
            id.set(upload(scope).id());
            assertThat(exists(id.get())).isTrue();
            throw new IllegalStateException("synthetic upload rollback");
        })).isInstanceOf(IllegalStateException.class).hasMessage("synthetic upload rollback");
        assertThat(exists(id.get())).isFalse();
    }

    @Test
    void expiryCleanupRemovesExpiredRowsAcrossOwnersButKeepsFreshPreviews() {
        Scope other = workspace(account());
        UUID expired = upload(scope).id();
        UUID otherExpired = upload(other).id();
        UUID fresh = upload(scope).id();
        // Expiry changes and cleanup share a transaction, independent of the scheduled cleaner.
        tx.executeWithoutResult(status -> {
            expireNow(expired);
            expireNow(otherExpired);
            assertThat(exists(expired)).isTrue();
            status(410, () -> attachments.resolve(scope.user(), scope.workspace(), scope.project(), List.of(expired)));
            attachments.expire();
            assertThat(exists(expired)).isFalse();
            assertThat(exists(otherExpired)).isFalse();
            assertThat(exists(fresh)).isTrue();
        });
        status(410, () -> attachments.resolve(scope.user(), scope.workspace(), scope.project(), List.of(expired)));
        status(410, () -> start(scope, List.of(expired)));
        assertThat(exists(fresh)).isTrue();
        assertNoStart(scope);
    }

    @Test
    void twelveItemQuotaIsPerAccountAcrossWorkspacesAndReclaimsOnlyThatOwnersExpiredRows() {
        Scope otherWorkspace = workspace(scope.user());
        Scope otherOwner = workspace(account());
        List<UUID> ids = new ArrayList<>();
        for (int i = 0; i < 12; i++) ids.add(upload(i % 2 == 0 ? scope : otherWorkspace).id());
        UUID unrelated = upload(otherOwner).id();
        clearInvocations(reader);
        status(429, () -> upload(otherWorkspace));
        verifyNoInteractions(reader);
        assertThat(count(scope.user())).isEqualTo(12);

        tx.executeWithoutResult(status -> {
            expireNow(ids.getFirst());
            expireNow(unrelated);
            upload(otherWorkspace);
            assertThat(exists(ids.getFirst())).isFalse();
            assertThat(exists(unrelated)).isTrue(); // Upload cleanup is owner-scoped.
            assertThat(count(scope.user())).isEqualTo(12);
        });
        upload(otherOwner);
        assertThat(count(otherOwner.user())).isOne();
    }

    @Test
    void concurrentUploadsOnDifferentProjectsWaitOnTheAccountRowAndCannotExceedTwelve() throws Exception {
        Scope otherWorkspace = workspace(scope.user());
        for (int i = 0; i < 11; i++) seed(i % 2 == 0 ? scope : otherWorkspace, 1, "reference");
        var readerEntered = new CountDownLatch(1);
        var releaseReader = new CountDownLatch(1);
        var calls = new AtomicInteger();
        var lockHolderPid = new AtomicInteger();
        doAnswer(invocation -> {
            calls.incrementAndGet();
            lockHolderPid.set(jdbc.queryForObject("SELECT pg_backend_pid()", Integer.class));
            readerEntered.countDown();
            if (!releaseReader.await(15, TimeUnit.SECONDS)) throw new IllegalStateException("Reader barrier timed out");
            return extraction("data.txt", ORIGINAL.length, EXTRACTED);
        }).when(reader).read(any(), anyString());

        try (var pool = Executors.newFixedThreadPool(2)) {
            try {
                var first = pool.submit(() -> upload(scope));
                assertThat(readerEntered.await(10, TimeUnit.SECONDS)).isTrue();
                var second = pool.submit(() -> {
                    try {
                        upload(otherWorkspace);
                        return 201;
                    } catch (ResponseStatusException error) {
                        return error.getStatusCode().value();
                    }
                });
                awaitAccountRowWait(lockHolderPid.get());
                assertThat(calls.get()).isOne();
                assertThat(second.isDone()).isFalse();
                releaseReader.countDown();
                assertThat(first.get(15, TimeUnit.SECONDS).id()).isNotNull();
                assertThat(second.get(15, TimeUnit.SECONDS)).isEqualTo(429);
            } finally {
                releaseReader.countDown();
            }
        }
        assertThat(calls.get()).isOne();
        assertThat(count(scope.user())).isEqualTo(12);
        assertNoStart(scope);
    }

    @Test
    void resolutionAndConsumptionRequireOwnerWorkspaceAndProjectTogether() {
        UUID id = upload(scope).id();
        UUID otherUser = account();
        addOwner(scope.workspace(), otherUser, scope.user());
        Scope anotherOwner = new Scope(otherUser, scope.workspace(), scope.project());
        Scope anotherProject = project(scope.user(), scope.workspace());
        Scope anotherWorkspace = workspace(scope.user());
        for (Scope wrong : List.of(anotherOwner, anotherProject, anotherWorkspace)) {
            status(410, () -> attachments.resolve(wrong.user(), wrong.workspace(), wrong.project(), List.of(id)));
            status(410, () -> start(wrong, List.of(id)));
            tx.executeWithoutResult(status -> attachments.consume(wrong.user(), wrong.workspace(), wrong.project(), List.of(id)));
            assertThat(exists(id)).isTrue();
            assertNoStart(wrong);
        }
        status(410, () -> attachments.resolve(scope.user(), anotherWorkspace.workspace(), scope.project(), List.of(id)));
        tx.executeWithoutResult(status -> attachments.consume(scope.user(), anotherWorkspace.workspace(), scope.project(), List.of(id)));
        assertThat(exists(id)).isTrue();
        assertThat(attachments.resolve(scope.user(), scope.workspace(), scope.project(), List.of(id))).hasSize(1);
    }

    @Test
    void deleteIsIdempotentAndCannotRemoveAnotherOwnersOrProjectsPreview() {
        UUID id = upload(scope).id();
        UUID otherUser = account();
        addOwner(scope.workspace(), otherUser, scope.user());
        Scope anotherProject = project(scope.user(), scope.workspace());
        Scope anotherWorkspace = workspace(scope.user());
        attachments.delete(otherUser, scope.workspace(), scope.project(), id);
        attachments.delete(scope.user(), scope.workspace(), anotherProject.project(), id);
        attachments.delete(scope.user(), anotherWorkspace.workspace(), anotherWorkspace.project(), id);
        status(404, () -> attachments.delete(scope.user(), anotherWorkspace.workspace(), scope.project(), id));
        assertThat(exists(id)).isTrue();
        attachments.delete(scope.user(), scope.workspace(), scope.project(), id);
        attachments.delete(scope.user(), scope.workspace(), scope.project(), id);
        assertThat(exists(id)).isFalse();
    }

    @Test
    void missingMembershipAndForeignProjectFailBeforeExtraction() {
        UUID outsider = account();
        Scope otherWorkspace = workspace(scope.user());
        status(404, () -> upload(new Scope(outsider, scope.workspace(), scope.project())));
        status(404, () -> upload(new Scope(scope.user(), otherWorkspace.workspace(), scope.project())));
        verifyNoInteractions(reader);
        assertThat(count(scope.user())).isZero();
        assertThat(count(outsider)).isZero();
    }

    @Test
    void revokedMembershipBlocksUploadDeleteAndStartWithoutConsumingExistingPreview() {
        UUID id = upload(scope).id();
        clearInvocations(reader);
        jdbc.update("UPDATE app.workspace_member SET status = 'SUSPENDED' WHERE workspace_id = ? AND user_id = ?",
            scope.workspace(), scope.user());
        status(404, () -> upload(scope));
        status(404, () -> attachments.delete(scope.user(), scope.workspace(), scope.project(), id));
        status(404, () -> start(scope, List.of(id)));
        assertThat(exists(id)).isTrue();
        verifyNoInteractions(reader);
        assertNoStart(scope);
    }

    @Test
    void revokedRequiredPermissionIsRecheckedForExistingPreviews() {
        UUID id = upload(scope).id();
        clearInvocations(reader);
        for (String permission : List.of("agent.run", "project.read")) {
            tx.executeWithoutResult(transaction -> {
                jdbc.update("DELETE FROM app.role_permission WHERE workspace_id = ? AND permission_code = ?",
                    scope.workspace(), permission);
                status(403, () -> upload(scope));
                status(403, () -> attachments.delete(scope.user(), scope.workspace(), scope.project(), id));
                status(403, () -> start(scope, List.of(id)));
                assertThat(exists(id)).isTrue();
                transaction.setRollbackOnly();
            });
        }
        verifyNoInteractions(reader);
        assertNoStart(scope);
    }

    @Test
    void deletingProjectBlocksUploadDeleteAndStartWithoutConsumingPreview() {
        UUID id = upload(scope).id();
        clearInvocations(reader);
        jdbc.update("UPDATE app.project SET deletion_requested_at = CURRENT_TIMESTAMP WHERE id = ?", scope.project());
        assertThatThrownBy(() -> upload(scope)).isInstanceOf(ProjectDeletionInProgressException.class);
        assertThatThrownBy(() -> attachments.delete(scope.user(), scope.workspace(), scope.project(), id))
            .isInstanceOf(ProjectDeletionInProgressException.class);
        status(409, () -> start(scope, List.of(id)));
        assertThat(exists(id)).isTrue();
        verifyNoInteractions(reader);
        assertNoStart(scope);
    }

    @Test
    void successfulStartStoresExtractionInDurableCommandConsumesOnceAndReplaysWithoutStaging() {
        UUID selected = upload(scope).id();
        UUID unused = upload(scope).id();
        clearInvocations(reader);
        var request = request(List.of(selected));
        String key = UUID.randomUUID().toString();
        var accepted = gateway.start(scope.user(), scope.workspace(), scope.project(), request, null, key);
        assertThat(exists(selected)).isFalse();
        assertThat(exists(unused)).isTrue();
        String payload = command(accepted.runId());
        var internal = mapper.readValue(payload, InternalAgentRunRequest.class);
        assertThat(internal.input().attachments()).containsExactly(extraction("data.txt", ORIGINAL.length, EXTRACTED));
        assertThat(internal.context().initiatedBy()).isEqualTo(scope.user());
        assertNoOriginal(payload);
        var replay = gateway.start(scope.user(), scope.workspace(), scope.project(), request, null, key);
        assertThat(replay.runId()).isEqualTo(accepted.runId());
        assertThat(countRuns(scope)).isOne();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM app.agent_run_command WHERE run_id = ?", Integer.class, accepted.runId())).isOne();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM app.platform_spend_reservation WHERE user_id = ?", Integer.class, scope.user())).isOne();
        verifyNoInteractions(reader);
    }

    @Test
    void callerRollbackRestoresConsumedPreviewAndRemovesStartCommandAndReservation() {
        UUID id = upload(scope).id();
        String key = UUID.randomUUID().toString();
        AtomicReference<UUID> run = new AtomicReference<>();
        assertThatThrownBy(() -> tx.executeWithoutResult(status -> {
            var accepted = gateway.start(scope.user(), scope.workspace(), scope.project(), request(List.of(id)), null, key);
            run.set(accepted.runId());
            assertThat(exists(id)).isFalse();
            assertThat(countRuns(scope)).isOne();
            throw new IllegalStateException("synthetic START rollback");
        })).isInstanceOf(IllegalStateException.class).hasMessage("synthetic START rollback");
        assertThat(exists(id)).isTrue();
        assertNoStart(scope);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM app.agent_run_command WHERE run_id = ?", Integer.class, run.get())).isZero();
        assertThat(gateway.start(scope.user(), scope.workspace(), scope.project(), request(List.of(id)), null, key).runId())
            .isNotEqualTo(run.get());
        assertThat(exists(id)).isFalse();
    }

    @Test
    void databaseCommandFailureRollsBackConsumptionAndAllowsTheSameRequestToRetry() {
        UUID id = upload(scope).id();
        String key = UUID.randomUUID().toString();
        String name = "attachment_failure_" + UUID.randomUUID().toString().replace("-", "");
        jdbc.execute("CREATE FUNCTION app." + name + "() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN "
            + "RAISE EXCEPTION 'synthetic attachment command failure'; END; $$");
        try {
            jdbc.execute("CREATE TRIGGER " + name + " BEFORE INSERT ON app.agent_run_command FOR EACH ROW "
                + "WHEN (NEW.requested_by = '" + scope.user() + "'::uuid) EXECUTE FUNCTION app." + name + "()");
            assertThatThrownBy(() -> gateway.start(scope.user(), scope.workspace(), scope.project(), request(List.of(id)), null, key))
                .isInstanceOf(DataAccessException.class).hasStackTraceContaining("synthetic attachment command failure");
            assertThat(exists(id)).isTrue();
            assertNoStart(scope);
        } finally {
            jdbc.execute("DROP TRIGGER IF EXISTS " + name + " ON app.agent_run_command");
            jdbc.execute("DROP FUNCTION app." + name + "()");
        }
        var retried = gateway.start(scope.user(), scope.workspace(), scope.project(), request(List.of(id)), null, key);
        assertThat(exists(id)).isFalse();
        assertThat(command(retried.runId())).contains(EXTRACTED);
    }

    @Test
    void startRejectsDuplicateAndSeventhAttachmentWithoutConsumingThenAcceptsSix() {
        List<UUID> ids = new ArrayList<>();
        for (int i = 0; i < 7; i++) ids.add(seed(scope, 1, "reference " + i));
        status(400, () -> start(scope, ids));
        status(400, () -> start(scope, List.of(ids.getFirst(), ids.getFirst())));
        assertThat(count(scope.user())).isEqualTo(7);
        assertNoStart(scope);
        var accepted = start(scope, ids.subList(0, 6));
        assertThat(mapper.readValue(command(accepted.runId()), InternalAgentRunRequest.class).input().attachments()).hasSize(6);
        assertThat(count(scope.user())).isOne();
        assertThat(exists(ids.getLast())).isTrue();
    }

    @Test
    void aggregateSizeRejectsMoreThanEightMibAndAcceptsExactBoundary() {
        List<UUID> ids = new ArrayList<>();
        for (int i = 0; i < 5; i++) ids.add(seed(scope, 2L * MIB, "reference"));
        status(413, () -> start(scope, ids));
        assertThat(count(scope.user())).isEqualTo(5);
        assertNoStart(scope);
        assertThat(attachments.resolve(scope.user(), scope.workspace(), scope.project(), ids.subList(0, 4))).hasSize(4);
        assertThat(count(scope.user())).isEqualTo(5);
        start(scope, ids.subList(0, 4));
        assertThat(count(scope.user())).isOne();
        assertThat(exists(ids.getLast())).isTrue();
    }

    @Test
    void aggregateTextCountsUnicodeCodePointsAndAcceptsExactFortyThousandBoundary() {
        UUID first = seed(scope, 100, "\uD83D\uDE00".repeat(20000));
        UUID second = seed(scope, 100, "\uD83D\uDE00".repeat(20000));
        UUID overflow = seed(scope, 1, "x");
        status(413, () -> start(scope, List.of(first, second, overflow)));
        assertThat(count(scope.user())).isEqualTo(3);
        assertNoStart(scope);
        var accepted = start(scope, List.of(first, second));
        var contents = mapper.readValue(command(accepted.runId()), InternalAgentRunRequest.class).input().attachments();
        assertThat(contents.stream().mapToInt(item -> item.text().codePointCount(0, item.text().length())).sum()).isEqualTo(40000);
        assertThat(exists(overflow)).isTrue();
        assertThat(count(scope.user())).isOne();
    }

    private ChatAttachmentService.Preview upload(Scope target) {
        return attachments.upload(target.user(), target.workspace(), target.project(),
            new MockMultipartFile("file", "data.txt", "text/plain", ORIGINAL), "auto", "auto");
    }

    private StartAgentRunResponse start(Scope target, List<UUID> ids) {
        return gateway.start(target.user(), target.workspace(), target.project(), request(ids), null, UUID.randomUUID().toString());
    }

    private StartAgentRunRequest request(List<UUID> ids) {
        return new StartAgentRunRequest("Synthetic attachment analysis", "en-US", "US",
            new StartAgentRunRequest.ModelSelection(Provider.OPENAI, "gpt-6-luna", ReasoningEffort.LOW),
            new StartAgentRunRequest.RunBudget(60, 2, 2, 1000, 1000, 1, 1, 0, 0, 0),
            new StartAgentRunRequest.SafetyContext(false, false, false, false, false, false, false), null, ids);
    }

    private AttachmentText extraction(String name, long size, String text) {
        return new AttachmentText(name, "text/plain", size, "a".repeat(64), "COMPLETE", text, "", "utf-8", null, 1);
    }

    /** Boundary fixtures bypass parsing only; resolve and START still use real stored JSONB. */
    private UUID seed(Scope target, long size, String text) {
        return insert(target.user(), target.workspace(), target.project(), extraction("data.txt", size, text));
    }

    private UUID insert(UUID owner, UUID workspace, UUID project, AttachmentText text) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
            INSERT INTO app.chat_attachment(id, workspace_id, project_id, owner_id, payload, expires_at)
            VALUES (?, ?, ?, ?, ?::jsonb, CURRENT_TIMESTAMP + INTERVAL '30 minutes')
            """, id, workspace, project, owner, mapper.writeValueAsString(text));
        return id;
    }

    private UUID account() {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO app.user_account(id, external_subject, email, status) VALUES (?, ?, ?, 'ACTIVE')",
            id, "attachment-test:" + id, id + "@example.invalid");
        return id;
    }

    private Scope workspace(UUID owner) {
        UUID workspace = workspaces.create(owner, "Synthetic attachments", "attachments-" + UUID.randomUUID()).workspaceId();
        return project(owner, workspace);
    }

    private Scope project(UUID owner, UUID workspace) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
            INSERT INTO app.project(id, workspace_id, title, requirement_text, currency, status, created_by)
            VALUES (?, ?, 'Synthetic attachments', 'Synthetic request', 'USD', 'LEAD', ?)
            """, id, workspace, owner);
        return new Scope(owner, workspace, id);
    }

    private void addOwner(UUID workspace, UUID user, UUID assignedBy) {
        UUID membership = UUID.randomUUID();
        jdbc.update("INSERT INTO app.workspace_member(id, workspace_id, user_id, status, joined_at) VALUES (?, ?, ?, 'ACTIVE', CURRENT_TIMESTAMP)",
            membership, workspace, user);
        jdbc.update("""
            INSERT INTO app.member_role(workspace_id, membership_id, role_id, assigned_by)
            SELECT ?, ?, id, ? FROM app.workspace_role WHERE workspace_id = ? AND code = 'OWNER'
            """, workspace, membership, assignedBy, workspace);
    }

    private int count(UUID owner) {
        return jdbc.queryForObject("SELECT count(*) FROM app.chat_attachment WHERE owner_id = ?", Integer.class, owner);
    }

    private boolean exists(UUID id) {
        return Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM app.chat_attachment WHERE id = ?)", Boolean.class, id));
    }

    private void expireNow(UUID id) {
        jdbc.update("UPDATE app.chat_attachment SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE id = ?", id);
    }

    private int countRuns(Scope target) {
        return jdbc.queryForObject("SELECT count(*) FROM app.agent_run WHERE workspace_id = ? AND project_id = ?", Integer.class,
            target.workspace(), target.project());
    }

    private String command(UUID run) {
        return jdbc.queryForObject("SELECT payload::text FROM app.agent_run_command WHERE run_id = ? AND command_type = 'START'", String.class, run);
    }

    private void assertNoStart(Scope target) {
        assertThat(countRuns(target)).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM app.platform_spend_reservation WHERE user_id = ?", Integer.class, target.user())).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM app.agent_start_idempotency WHERE user_id = ?", Integer.class, target.user())).isZero();
    }

    private void assertNoOriginal(String value) {
        assertThat(value).doesNotContain(new String(ORIGINAL, StandardCharsets.UTF_8), Base64.getEncoder().encodeToString(ORIGINAL), "\"base64\"");
    }

    private void status(int expected, Runnable action) {
        assertThatThrownBy(action::run).isInstanceOfSatisfying(ResponseStatusException.class,
            error -> assertThat(error.getStatusCode().value()).isEqualTo(expected));
    }

    private void awaitAccountRowWait(int holderPid) throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        while (System.nanoTime() < deadline) {
            Boolean blocked = jdbc.queryForObject("""
                SELECT EXISTS(SELECT 1 FROM pg_stat_activity
                    WHERE wait_event_type = 'Lock' AND ? = ANY(pg_blocking_pids(pid))
                      AND lower(query) LIKE '%from app.user_account%for update%')
                """, Boolean.class, holderPid);
            if (Boolean.TRUE.equals(blocked)) return;
            Thread.sleep(25);
        }
        throw new AssertionError("Second project upload never waited on the first upload's account row lock");
    }

    private static KeyPair signingKeys() {
        try {
            var generator = KeyPairGenerator.getInstance("RSA");
            generator.initialize(2048);
            return generator.generateKeyPair();
        } catch (GeneralSecurityException error) {
            throw new IllegalStateException("Cannot create ephemeral attachment test signing key", error);
        }
    }

    private record Scope(UUID user, UUID workspace, UUID project) { }
}
