package com.freelanceops.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.freelanceops.backend.domain.quotation.dto.request.CreateQuotationRequest;
import com.freelanceops.backend.domain.quotation.dto.request.MoveRateCardRequest;
import com.freelanceops.backend.domain.quotation.dto.request.QuotationBasisRequest;
import com.freelanceops.backend.domain.quotation.dto.request.QuotationItemRequest;
import com.freelanceops.backend.domain.quotation.dto.request.UpsertRateCardFolderRequest;
import com.freelanceops.backend.domain.quotation.dto.request.UpsertRateCardRequest;
import com.freelanceops.backend.domain.quotation.dto.response.RateCardResponse;
import com.freelanceops.backend.domain.quotation.model.BasisType;
import com.freelanceops.backend.domain.quotation.model.QuotationScenario;
import com.freelanceops.backend.domain.quotation.model.WorkUnit;
import com.freelanceops.backend.domain.quotation.repository.RateCardFolderRepository;
import com.freelanceops.backend.domain.quotation.service.PricingConfigurationService;
import com.freelanceops.backend.domain.quotation.service.QuotationService;
import com.freelanceops.backend.domain.quotation.service.RateCardFolderService;
import com.freelanceops.backend.domain.workspace.service.WorkspaceProvisioningService;

import org.hibernate.resource.jdbc.spi.StatementInspector;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.dao.DataAccessException;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.server.ResponseStatusException;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/** 실제 권한·Flyway·복합 외래 키·행 잠금으로 가상 폴더와 기존 견적을 검증한다. */
@Testcontainers(disabledWithoutDocker = true)
@SpringBootTest(
        properties = {
            "app.environment=test",
            "spring.flyway.create-schemas=true",
            "agent.command-dispatch-enabled=false",
            "agent.task-command-dispatch-enabled=false",
            "agent.reconciliation-enabled=false",
            "app.rate-limit.enabled=false",
            "spring.jpa.properties.hibernate.session_factory.statement_inspector=com.freelanceops.backend.integration.RateCardFolderPostgresTest$FolderQueries"
        })
@AutoConfigureMockMvc
@Timeout(90)
public class RateCardFolderPostgresTest {
    @Container
    static final PostgreSQLContainer POSTGRES =
            new PostgreSQLContainer(
                    DockerImageName.parse("pgvector/pgvector:pg17")
                            .asCompatibleSubstituteFor("postgres"));

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired RateCardFolderService folders;
    @Autowired RateCardFolderRepository folderRepository;
    @Autowired PricingConfigurationService pricing;
    @Autowired QuotationService quotations;
    @Autowired WorkspaceProvisioningService workspaces;
    @Autowired JdbcTemplate jdbc;
    @Autowired MockMvc mvc;

    private UUID user;
    private UUID workspace;

    public static class FolderQueries implements StatementInspector {
        private static final ThreadLocal<List<String>> QUERIES = ThreadLocal.withInitial(ArrayList::new);

        @Override
        public String inspect(String sql) {
            if (sql.startsWith("select ") && sql.contains(" from app.rate_card_folder ")) QUERIES.get().add(sql);
            return sql;
        }

        static void reset() {
            QUERIES.get().clear();
        }

        static List<String> queries() {
            return List.copyOf(QUERIES.get());
        }
    }

    @BeforeEach
    void setup() {
        user = account();
        workspace = workspaces.create(user, "Folder fixture", "folders-" + UUID.randomUUID()).workspaceId();
        FolderQueries.reset();
    }

    @Test
    void hierarchyPersistsAcrossReadsAndReturnsTheFlushedVersion() {
        UUID root = folder(null, "Root");
        UUID child = folder(root, "Child");
        UUID leaf = folder(child, "Leaf");
        assertThat(folders.listFolders(user, workspace)).hasSize(3);
        var renamed = folders.upsertFolder(user, workspace, child, new UpsertRateCardFolderRequest(" Renamed ", root, null));
        assertThat(renamed.name()).isEqualTo("Renamed");
        assertThat(renamed.version()).isEqualTo(version(child));
        var repeated = folders.upsertFolder(user, workspace, child, new UpsertRateCardFolderRequest("Renamed", root, null));
        assertThat(repeated).isEqualTo(renamed);
        assertStatus(409, () -> folders.upsertFolder(user, workspace, root, new UpsertRateCardFolderRequest("Root", leaf, null)));
        assertStatus(409, () -> folders.upsertFolder(user, workspace, child, new UpsertRateCardFolderRequest("Renamed", child, null)));
        folders.upsertFolder(user, workspace, child, new UpsertRateCardFolderRequest("Renamed", null, null));
        assertThat(folders.listFolders(user, workspace)).filteredOn(item -> item.id().equals(child)).singleElement()
                .satisfies(item -> assertThat(item.parentId()).isNull());
        assertStatus(409, () -> folder(null, "root"));
    }

    @Test
    void versionedEditsCannotResurrectDeletedFoldersOrOverwriteOtherClients() throws Exception {
        UUID target = folder(null, "Original");
        long originalVersion = version(target);
        var saved = folders.upsertFolder(user, workspace, target,
                new UpsertRateCardFolderRequest("First client", null, originalVersion));
        assertThat(saved.version()).isGreaterThan(originalVersion);
        assertThat(folders.upsertFolder(user, workspace, target,
                new UpsertRateCardFolderRequest("First client", null, originalVersion))).isEqualTo(saved);
        assertStatus(409, () -> folders.upsertFolder(user, workspace, target,
                new UpsertRateCardFolderRequest("Stale second client", null, originalVersion)));
        folders.deleteFolder(user, workspace, target);

        mvc.perform(put("/api/v2/workspaces/" + workspace + "/rate-card-folders/" + target).with(jwt().jwt(token -> token.subject(user.toString())))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Stale rename\",\"parentId\":null,\"expectedVersion\":" + saved.version() + "}"))
                .andExpect(status().isConflict());
        assertThat(folderRepository.findById(target)).isEmpty();
    }

    @Test
    void classificationAndLegacyEditingPreserveTheSavedQuotationSnapshot() {
        UUID root = folder(null, "Root");
        UUID child = folder(root, "Child");
        RateCardResponse card = rate(true);
        UUID project = project();
        var created = quotations.create(user, workspace, project, new CreateQuotationRequest(
                QuotationScenario.RECOMMENDED, "KRW", BigDecimal.ZERO, false, null,
                List.of(new QuotationItemRequest(card.id(), "Stored item", "", BigDecimal.ONE,
                        null, null, BigDecimal.ZERO, new QuotationBasisRequest(
                                BasisType.ASSUMPTION, "Synthetic basis", null, null, null, null)))));
        // DB의 시각 정밀도·소수 자릿수 정규화가 끝난 저장본을 이동 전 기준으로 삼는다.
        var quotation = quotations.get(user, workspace, created.id());
        var moved = folders.moveRateCard(user, workspace, card.id(), new MoveRateCardRequest(child));
        assertThat(moved.folderId()).isEqualTo(child);
        assertThat(moved.version()).isGreaterThan(card.version());
        assertThat(moved.version()).isEqualTo(jdbc.queryForObject("SELECT version FROM app.rate_card WHERE id=?", Long.class, card.id()));
        assertThat(folders.moveRateCard(user, workspace, card.id(), new MoveRateCardRequest(child))).isEqualTo(moved);

        var edited = pricing.upsertRateCard(user, workspace, card.id(), new UpsertRateCardRequest(
                "Updated rate", WorkUnit.DAY, new BigDecimal("900.50"), BigDecimal.ONE, "KRW", false));
        assertThat(edited.folderId()).isEqualTo(child);
        assertThat(edited.version()).isGreaterThan(moved.version());
        assertStatus(409, () -> folders.deleteFolder(user, workspace, child));
        assertStatus(409, () -> folders.deleteFolder(user, workspace, root));
        assertThat(quotations.get(user, workspace, quotation.id())).isEqualTo(quotation);

        folders.moveRateCard(user, workspace, card.id(), new MoveRateCardRequest(null));
        folders.deleteFolder(user, workspace, child);
        folders.deleteFolder(user, workspace, root);
        assertThat(pricing.listRateCards(user, workspace)).singleElement().satisfies(item -> {
            assertThat(item.id()).isEqualTo(card.id());
            assertThat(item.folderId()).isNull();
            assertThat(item.active()).isFalse();
            assertThat(item.rate()).isEqualByComparingTo("900.50");
        });
        assertThat(quotations.get(user, workspace, quotation.id())).isEqualTo(quotation);
    }

    @Test
    void databaseConstraintsRejectForeignParentsAssignmentsAndSelfReferences() {
        UUID target = folder(null, "Local");
        UUID other = workspaces.create(user, "Other", "other-" + UUID.randomUUID()).workspaceId();
        UUID foreign = UUID.randomUUID();
        folders.upsertFolder(user, other, foreign, new UpsertRateCardFolderRequest("Private", null, null));
        UUID card = rate(false).id();
        UUID otherRoot = folder(null, "Other root");
        assertThatThrownBy(() -> jdbc.update("UPDATE app.rate_card_folder SET name='local' WHERE id=?", otherRoot)).isInstanceOf(DataAccessException.class);
        assertStatus(404, () -> folders.upsertFolder(user, workspace, target, new UpsertRateCardFolderRequest("Local", foreign, null)));
        assertStatus(404, () -> folders.upsertFolder(user, workspace, foreign, new UpsertRateCardFolderRequest("Overwrite", null, null)));
        assertStatus(404, () -> folders.moveRateCard(user, workspace, card, new MoveRateCardRequest(foreign)));
        assertThatThrownBy(() -> jdbc.update("UPDATE app.rate_card_folder SET parent_id=? WHERE id=?", foreign, target)).isInstanceOf(DataAccessException.class);
        assertThatThrownBy(() -> jdbc.update("UPDATE app.rate_card_folder SET parent_id=id WHERE id=?", target)).isInstanceOf(DataAccessException.class);
        assertThatThrownBy(() -> jdbc.update("UPDATE app.rate_card SET folder_id=? WHERE id=?", foreign, card)).isInstanceOf(DataAccessException.class);
        folders.moveRateCard(user, workspace, card, new MoveRateCardRequest(target));
        UUID nested = folder(target, "Nested");
        folder(nested, "Grandchild");
        assertThatThrownBy(() -> jdbc.update("DELETE FROM app.rate_card_folder WHERE id=?", target)).isInstanceOf(DataAccessException.class);
        jdbc.update("DELETE FROM app.workspace WHERE id=?", workspace);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM app.rate_card_folder WHERE workspace_id=?", Integer.class, workspace)).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM app.rate_card WHERE workspace_id=?", Integer.class, workspace)).isZero();
        assertThat(folders.listFolders(user, other)).hasSize(1);
    }

    @Test
    void concurrentOppositeMovesCannotIntroduceACycle() throws Exception {
        UUID first = folder(null, "First");
        UUID second = folder(null, "Second");
        CountDownLatch start = new CountDownLatch(1);
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var a = executor.submit(() -> after(start, () -> folders.upsertFolder(user, workspace, first, new UpsertRateCardFolderRequest("First", second, null))));
            var b = executor.submit(() -> after(start, () -> folders.upsertFolder(user, workspace, second, new UpsertRateCardFolderRequest("Second", first, null))));
            start.countDown();
            assertThat(List.of(a.get(20, TimeUnit.SECONDS), b.get(20, TimeUnit.SECONDS))).containsExactlyInAnyOrder(200, 409);
        }
        assertThat(jdbc.queryForObject("SELECT count(*) FROM app.rate_card_folder WHERE workspace_id=? AND parent_id IS NULL", Integer.class, workspace)).isEqualTo(1);
    }

    @Test
    void aDeleteRacingWithAnAssignmentNeverLeavesAnOrphan() throws Exception {
        UUID target = folder(null, "Target");
        UUID card = rate(true).id();
        CountDownLatch start = new CountDownLatch(1);
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var moving = executor.submit(() -> after(start, () -> folders.moveRateCard(user, workspace, card, new MoveRateCardRequest(target))));
            var deleting = executor.submit(() -> after(start, () -> folders.deleteFolder(user, workspace, target)));
            start.countDown();
            List<Integer> results = List.of(moving.get(20, TimeUnit.SECONDS), deleting.get(20, TimeUnit.SECONDS));
            assertThat(results).isIn(List.of(200, 409), List.of(404, 200));
        }
        assertThat(jdbc.queryForObject("SELECT count(*) FROM app.rate_card c LEFT JOIN app.rate_card_folder f ON f.id=c.folder_id AND f.workspace_id=c.workspace_id WHERE c.id=? AND c.folder_id IS NOT NULL AND f.id IS NULL", Integer.class, card)).isZero();
    }

    @Test
    void httpEndpointsEnforceReadOnlyAndForeignWorkspaceAccess() throws Exception {
        UUID target = folder(null, "Readable");
        UUID card = rate(true).id();
        UUID viewer = viewer();
        String base = "/api/v2/workspaces/" + workspace;
        mvc.perform(get(base + "/rate-card-folders").with(jwt().jwt(token -> token.subject(viewer.toString()))))
                .andExpect(status().isOk()).andExpect(jsonPath("$[0].id").value(target.toString()));
        mvc.perform(put(base + "/rate-card-folders/" + UUID.randomUUID()).with(jwt().jwt(token -> token.subject(viewer.toString())))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"Denied\",\"parentId\":null}"))
                .andExpect(status().isForbidden());
        mvc.perform(delete(base + "/rate-card-folders/" + target).with(jwt().jwt(token -> token.subject(viewer.toString()))))
                .andExpect(status().isForbidden());
        mvc.perform(put(base + "/rate-cards/" + card + "/folder").with(jwt().jwt(token -> token.subject(viewer.toString())))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"folderId\":null}"))
                .andExpect(status().isForbidden());
        UUID outsider = account();
        mvc.perform(get(base + "/rate-card-folders").with(jwt().jwt(token -> token.subject(outsider.toString()))))
                .andExpect(status().isNotFound());
        mvc.perform(put(base + "/rate-card-folders/" + UUID.randomUUID()).with(jwt().jwt(token -> token.subject(user.toString())))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"   \",\"parentId\":null}"))
                .andExpect(status().isBadRequest());
        mvc.perform(put(base + "/rate-cards/" + card + "/folder").with(jwt().jwt(token -> token.subject(user.toString())))
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isBadRequest());
        mvc.perform(put(base + "/rate-cards/" + card + "/folder").with(jwt().jwt(token -> token.subject(user.toString())))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"folderId\":\"" + target + "\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.folderId").value(target.toString()));
        UUID empty = folder(null, "Delete over HTTP");
        mvc.perform(delete(base + "/rate-card-folders/" + empty).with(jwt().jwt(token -> token.subject(user.toString()))))
                .andExpect(status().isNoContent());
    }

    @Test
    void quotaAllowsExistingRetriesEditsAndDeletionRecoveryWithoutAffectingOtherWorkspaces() {
        seedFolders(199);
        UUID last = folder(null, "Last allowed");
        assertThat(folders.listFolders(user, workspace)).hasSize(200);
        var original = folders.upsertFolder(user, workspace, last, new UpsertRateCardFolderRequest("Last allowed", null, null));
        assertThat(folders.upsertFolder(user, workspace, last, new UpsertRateCardFolderRequest("Last allowed", null, null))).isEqualTo(original);
        var renamed = folders.upsertFolder(user, workspace, last, new UpsertRateCardFolderRequest("Renamed at capacity", null, null));
        assertThat(renamed.version()).isGreaterThan(original.version());
        assertStatus(409, () -> folder(null, "One too many"));
        assertThat(jdbc.queryForObject("SELECT count(*) FROM app.rate_card_folder WHERE workspace_id=?", Integer.class, workspace)).isEqualTo(200);

        UUID other = workspaces.create(user, "Separate quota", "quota-" + UUID.randomUUID()).workspaceId();
        folders.upsertFolder(user, other, UUID.randomUUID(), new UpsertRateCardFolderRequest("Independent", null, null));
        assertThat(folders.listFolders(user, other)).hasSize(1);
        UUID card = rate(false).id();
        assertThat(folders.moveRateCard(user, workspace, card, new MoveRateCardRequest(last)).folderId()).isEqualTo(last);
        folders.moveRateCard(user, workspace, card, new MoveRateCardRequest(null));
        folders.deleteFolder(user, workspace, last);
        folder(null, "Recovered slot");
        assertThat(folders.listFolders(user, workspace)).hasSize(200);
    }

    @Test
    void legacyOverflowUsesAnIndexedLimitedQueryAndFailsInsteadOfReturningAPartialTree() {
        seedFolders(1000);
        FolderQueries.reset();
        assertThat(folderRepository.findTop201ByWorkspaceIdOrderByNameAscIdAsc(workspace)).hasSize(201);
        assertThat(FolderQueries.queries()).singleElement().satisfies(sql -> assertThat(sql)
                .contains("workspace_id=?", "order by", ".name", ".id", "fetch first ? rows only")
                .doesNotContain("count("));
        assertThat(jdbc.queryForObject("SELECT indexdef FROM pg_indexes WHERE schemaname='app' AND indexname='ix_rate_card_folder_list'", String.class))
                .contains("(workspace_id, name, id)");
        assertStatus(409, () -> folders.listFolders(user, workspace));
        assertStatus(409, () -> folder(null, "Overflow"));
        assertThat(jdbc.queryForObject("SELECT count(*) FROM app.rate_card_folder WHERE workspace_id=?", Integer.class, workspace)).isEqualTo(1000);
        UUID removable = jdbc.queryForObject("SELECT id FROM app.rate_card_folder WHERE workspace_id=? ORDER BY name,id LIMIT 1", UUID.class, workspace);
        folders.deleteFolder(user, workspace, removable);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM app.rate_card_folder WHERE workspace_id=?", Integer.class, workspace)).isEqualTo(999);
    }

    @Test
    void depthChecksIncludeEveryMovedDescendantAndAllowAnEighthLevelRetry() {
        List<UUID> chain = new ArrayList<>();
        for (int depth = 0; depth < 8; depth++) {
            chain.add(folder(chain.isEmpty() ? null : chain.getLast(), "Depth " + depth));
        }
        UUID leaf = chain.getLast();
        long revision = version(leaf);
        assertThat(folders.upsertFolder(user, workspace, leaf, new UpsertRateCardFolderRequest("Depth 7", chain.get(6), null)).version()).isEqualTo(revision);
        assertStatus(409, () -> folder(leaf, "Ninth level"));
        UUID moving = folder(null, "Moving subtree");
        UUID child = folder(moving, "Moving child");
        assertStatus(409, () -> folders.upsertFolder(user, workspace, moving, new UpsertRateCardFolderRequest("Moving subtree", chain.get(6), null)));
        assertThat(jdbc.queryForObject("SELECT parent_id FROM app.rate_card_folder WHERE id=?", UUID.class, moving)).isNull();
        var accepted = folders.upsertFolder(user, workspace, moving, new UpsertRateCardFolderRequest("Moving subtree", chain.get(5), null));
        assertThat(accepted.parentId()).isEqualTo(chain.get(5));
        assertThat(folders.listFolders(user, workspace)).filteredOn(item -> item.id().equals(child)).singleElement()
                .satisfies(item -> assertThat(item.parentId()).isEqualTo(moving));
    }

    @Test
    void concurrentCreationsCannotBothConsumeTheFinalSlot() throws Exception {
        seedFolders(199);
        CountDownLatch start = new CountDownLatch(1);
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var first = executor.submit(() -> after(start, () -> folder(null, "First contender")));
            var second = executor.submit(() -> after(start, () -> folder(null, "Second contender")));
            start.countDown();
            assertThat(List.of(first.get(20, TimeUnit.SECONDS), second.get(20, TimeUnit.SECONDS))).containsExactlyInAnyOrder(200, 409);
        }
        assertThat(jdbc.queryForObject("SELECT count(*) FROM app.rate_card_folder WHERE workspace_id=?", Integer.class, workspace)).isEqualTo(200);
    }

    private void seedFolders(int count) {
        jdbc.update("""
                INSERT INTO app.rate_card_folder(id,workspace_id,name,created_by,created_at,updated_at,version)
                SELECT gen_random_uuid(),?,'Seed ' || lpad(n::text,4,'0'),?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0
                FROM generate_series(1,?) AS n
                """, workspace, user, count);
    }

    private UUID folder(UUID parentId, String name) {
        UUID id = UUID.randomUUID();
        return folders.upsertFolder(user, workspace, id, new UpsertRateCardFolderRequest(name, parentId, null)).id();
    }

    private RateCardResponse rate(boolean active) {
        return pricing.upsertRateCard(user, workspace, UUID.randomUUID(), new UpsertRateCardRequest(
                "Synthetic rate", WorkUnit.HOUR, new BigDecimal("400.25"), new BigDecimal("100.00"), "KRW", active));
    }

    private long version(UUID id) {
        return jdbc.queryForObject("SELECT version FROM app.rate_card_folder WHERE id=?", Long.class, id);
    }

    private UUID account() {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO app.user_account(id,external_subject,email,status) VALUES (?,?,?,'ACTIVE')", id, id.toString(), id + "@example.invalid");
        return id;
    }

    private UUID viewer() {
        UUID viewer = account();
        UUID member = UUID.randomUUID();
        jdbc.update("INSERT INTO app.workspace_member(id,workspace_id,user_id,status,joined_at) VALUES (?,?,?,'ACTIVE',CURRENT_TIMESTAMP)", member, workspace, viewer);
        jdbc.update("INSERT INTO app.member_role(workspace_id,membership_id,role_id,assigned_by) SELECT ?,?,id,? FROM app.workspace_role WHERE workspace_id=? AND code='VIEWER'", workspace, member, user, workspace);
        return viewer;
    }

    private UUID project() {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO app.project(id,workspace_id,title,requirement_text,currency,status,created_by) VALUES (?,?,'Folder quotation fixture','Synthetic','KRW','LEAD',?)", id, workspace, user);
        return id;
    }

    private static int after(CountDownLatch start, Runnable operation) throws InterruptedException {
        start.await();
        try {
            operation.run();
            return 200;
        } catch (ResponseStatusException error) {
            return error.getStatusCode().value();
        }
    }

    private static void assertStatus(int status, Runnable operation) {
        assertThatThrownBy(operation::run).isInstanceOfSatisfying(ResponseStatusException.class,
                error -> assertThat(error.getStatusCode().value()).isEqualTo(status));
    }
}
