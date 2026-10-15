package com.freelanceops.backend.integration;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.freelanceops.backend.domain.quotation.dto.response.QuotationResponse;
import com.freelanceops.backend.domain.quotation.service.QuotationService;
import com.freelanceops.backend.domain.workspace.service.WorkspaceProvisioningService;

import org.hibernate.resource.jdbc.spi.StatementInspector;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.server.ResponseStatusException;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/** 테스트용 PostgreSQL·Flyway와 실제 권한 검사를 사용한다. 모델과 운영 데이터는 사용하지 않는다. */
@Testcontainers(disabledWithoutDocker = true)
@SpringBootTest(
        properties = {
            "app.environment=test",
            "spring.flyway.create-schemas=true",
            "agent.command-dispatch-enabled=false",
            "agent.reconciliation-enabled=false",
            "app.rate-limit.enabled=false",
            "spring.jpa.properties.hibernate.session_factory.statement_inspector=com.freelanceops.backend.integration.QuotationListPostgresTest$SqlCounter"
        })
@AutoConfigureMockMvc
public class QuotationListPostgresTest {
    @Container
    static final PostgreSQLContainer POSTGRES =
            new PostgreSQLContainer(
                    DockerImageName.parse("pgvector/pgvector:pg17")
                            .asCompatibleSubstituteFor("postgres"));

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired JdbcTemplate jdbc;
    @Autowired WorkspaceProvisioningService provisioning;
    @Autowired QuotationService service;
    @Autowired MockMvc mvc;
    UUID user, workspace, project;

    /** 견적 테이블 네 개의 쿼리만 센다. 권한과 프로젝트 조회는 별도로 검증한다. */
    public static class SqlCounter implements StatementInspector {
        private static final ThreadLocal<List<String>> QUERIES =
                ThreadLocal.withInitial(ArrayList::new);

        public String inspect(String sql) {
            if (sql.startsWith("select ") && sql.contains(" from app.quotation"))
                QUERIES.get().add(sql);
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
        user = user();
        workspace =
                provisioning
                        .create(user, "Quotation fixture", "quotes-" + UUID.randomUUID())
                        .workspaceId();
        project = project(workspace);
        SqlCounter.reset();
    }

    @ParameterizedTest
    @ValueSource(ints = {10, 100, 1000})
    void aBoundedPageUsesFourQueriesRegardlessOfHistorySize(int count) {
        seed(workspace, project, count);
        var page = service.listPage(user, workspace, project, 100, null);
        assertThat(page.items()).hasSize(Math.min(count, 100));
        assertThat(page.nextCursor() != null).isEqualTo(count > 100);
        assertThat(SqlCounter.queries()).hasSize(4);
        assertThat(SqlCounter.queries().getFirst())
                .contains("fetch first ? rows only")
                .doesNotContain("count(");
        assertThat(SqlCounter.queries().subList(1, 4))
                .allSatisfy(
                        sql -> {
                            assertThat(sql)
                                    .contains("workspace_id=?")
                                    .contains("quotation_id in (")
                                    .doesNotContain(" join ");
                            assertThat(sql.chars().filter(c -> c == '?').count())
                                    .isLessThanOrEqualTo(101);
                        });
        page.items()
                .forEach(
                        quotation -> {
                            assertThat(quotation.items())
                                    .extracting(item -> item.title())
                                    .containsExactly("Assumption item", "Evidence item");
                            assertThat(quotation.items().getFirst().basis().content())
                                    .isEqualTo("assumption:" + quotation.id());
                            assertThat(quotation.items().getLast().basis().content())
                                    .isEqualTo("evidence:" + quotation.id());
                        });
        QuotationResponse first = page.items().getFirst();
        assertThat(service.get(user, workspace, first.id())).isEqualTo(first);
    }

    @ParameterizedTest
    @ValueSource(ints = {0, 1, 100, 101, 1000})
    void compatibilityListPreservesEveryQuotationWithBoundedChildBatches(int count) {
        seed(workspace, project, count);
        var quotations = service.list(user, workspace, project);
        assertThat(quotations).hasSize(count);
        assertThat(SqlCounter.queries()).hasSize(1 + 3 * ((count + 99) / 100));
        assertThat(SqlCounter.queries())
                .allSatisfy(
                        sql ->
                                assertThat(sql.chars().filter(c -> c == '?').count())
                                        .isLessThanOrEqualTo(101));
        assertThat(quotations).extracting(QuotationResponse::id).doesNotHaveDuplicates();
    }

    @Test
    void
            tiedTimestampsTraverseWithoutMissingOrDuplicatingRowsAfterNewerInsertAndBoundaryDeletion() {
        seed(workspace, project, 205);
        List<UUID> expected =
                jdbc.queryForList(
                        "select id from app.quotation where project_id=? order by created_at desc,id desc",
                        UUID.class,
                        project);
        List<UUID> seen = new ArrayList<>();
        var first = service.listPage(user, workspace, project, 50, null);
        seen.addAll(first.items().stream().map(QuotationResponse::id).toList());
        // 커서가 가리키던 행이 삭제되어도 다음 페이지를 조회할 수 있어야 한다.
        jdbc.update("delete from app.quotation where id=?", seen.getLast());
        seed(workspace, project, 1);
        jdbc.update(
                "update app.quotation set created_at='2027-01-01T00:00:00Z' where project_id=? and id not in (select unnest(?::uuid[]))",
                project,
                expected.stream()
                        .map(UUID::toString)
                        .collect(java.util.stream.Collectors.joining(",", "{", "}")));
        String cursor = first.nextCursor();
        while (cursor != null) {
            SqlCounter.reset();
            var page = service.listPage(user, workspace, project, 50, cursor);
            assertThat(SqlCounter.queries().getFirst().replaceAll("\\s+", ""))
                    .contains("(q.created_at,q.id)<(?,?)")
                    .doesNotContain("or(");
            assertThat(page.items()).hasSizeLessThanOrEqualTo(50);
            seen.addAll(page.items().stream().map(QuotationResponse::id).toList());
            cursor = page.nextCursor();
        }
        assertThat(seen).containsExactlyElementsOf(expected).doesNotHaveDuplicates();
    }

    @Test
    void emptyPagesDoNotReadChildTablesAndScopePredicatesDoNotLeakAnotherProjectOrWorkspace() {
        UUID otherProject = project(workspace);
        UUID otherWorkspace =
                provisioning
                        .create(user, "Other fixture", "quotes-" + UUID.randomUUID())
                        .workspaceId();
        UUID foreignProject = project(otherWorkspace);
        seed(workspace, otherProject, 2);
        seed(otherWorkspace, foreignProject, 2);
        SqlCounter.reset();
        assertThat(service.listPage(user, workspace, project, 50, null).items()).isEmpty();
        assertThat(SqlCounter.queries()).hasSize(1);
        seed(workspace, project, 3);
        var page = service.listPage(user, workspace, project, 1, null);
        assertThat(page.items())
                .allSatisfy(
                        quotation -> {
                            assertThat(quotation.workspaceId()).isEqualTo(workspace);
                            assertThat(quotation.projectId()).isEqualTo(project);
                        });
        var otherPage =
                service.listPage(user, otherWorkspace, foreignProject, 100, page.nextCursor());
        assertThat(otherPage.items())
                .allSatisfy(
                        quotation -> assertThat(quotation.workspaceId()).isEqualTo(otherWorkspace));
        assertStatus(404, () -> service.listPage(user, workspace, foreignProject, 50, null));
        assertStatus(404, () -> service.listPage(user(), workspace, project, 50, null));
        jdbc.update(
                "delete from app.role_permission where workspace_id=? and permission_code='quotation.read'",
                workspace);
        assertStatus(403, () -> service.listPage(user, workspace, project, 50, null));
    }

    @Test
    void endpointValidatesBoundariesAndPreservesArrayCompatibility() throws Exception {
        seed(workspace, project, 2);
        String path = "/api/v2/workspaces/" + workspace + "/projects/" + project + "/quotations";
        mvc.perform(get(path + "/page")).andExpect(status().isUnauthorized());
        for (String limit : List.of("0", "-1", "101", "2147483648", "garbage")) {
            mvc.perform(
                            get(path + "/page")
                                    .param("limit", limit)
                                    .with(jwt().jwt(token -> token.subject(user.toString()))))
                    .andExpect(status().isBadRequest());
        }
        mvc.perform(
                        get(path + "/page")
                                .param("cursor", "broken!")
                                .with(jwt().jwt(token -> token.subject(user.toString()))))
                .andExpect(status().isBadRequest());
        mvc.perform(
                        get(path + "/page")
                                .param("limit", "1")
                                .with(jwt().jwt(token -> token.subject(user.toString()))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.nextCursor").isString());
        mvc.perform(get(path).with(jwt().jwt(token -> token.subject(user.toString()))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2));
    }

    @Test
    void latestVersionLookupStaysWithinTheSourcesSeriesAndWorkspace() {
        seed(workspace, project, 2);
        UUID source =
                jdbc.queryForObject(
                        "select id from app.quotation where project_id=? limit 1",
                        UUID.class,
                        project);
        UUID latest = UUID.randomUUID();
        jdbc.update(
                """
            insert into app.quotation (id,workspace_id,project_id,series_id,previous_version_id,version_number,scenario,status,currency,
              subtotal,discount_total,risk_buffer_rate,risk_buffer_amount,tax_rate,tax_amount,total,created_by,created_at,updated_at)
            select ?,workspace_id,project_id,series_id,id,2,scenario,status,currency,subtotal,discount_total,risk_buffer_rate,
              risk_buffer_amount,tax_rate,tax_amount,total,created_by,created_at,updated_at from app.quotation where id=?
            """,
                latest,
                source);
        assertThat(service.getLatest(user, workspace, source).id()).isEqualTo(latest);
        assertStatus(404, () -> service.getLatest(user, UUID.randomUUID(), source));
        assertStatus(404, () -> service.getLatest(user(), workspace, source));
    }

    private UUID user() {
        UUID id = UUID.randomUUID();
        jdbc.update(
                "insert into app.user_account(id,external_subject,email,status) values (?,?,?,'ACTIVE')",
                id,
                id.toString(),
                id + "@example.invalid");
        return id;
    }

    private UUID project(UUID workspaceId) {
        UUID id = UUID.randomUUID();
        jdbc.update(
                "insert into app.project(id,workspace_id,title,requirement_text,currency,status,created_by) values (?,?,'Synthetic quotation fixture','Fixture','KRW','LEAD',?)",
                id,
                workspaceId,
                user);
        return id;
    }

    private void seed(UUID workspaceId, UUID projectId, int count) {
        jdbc.update(
                """
            insert into app.quotation(id,workspace_id,project_id,series_id,version_number,scenario,status,currency,
              subtotal,discount_total,risk_buffer_rate,risk_buffer_amount,tax_rate,tax_amount,total,created_by,created_at,updated_at)
            select id,?,?,id,1,'RECOMMENDED','DRAFT','KRW',200,0,0,0,0,0,200,?,'2026-10-01T00:00:00.123456Z','2026-10-01T00:00:00.123456Z'
            from (select gen_random_uuid() id from generate_series(1,?)) fixture
            """,
                workspaceId,
                projectId,
                user,
                count);
        jdbc.update(
                """
            insert into app.quotation_assumption(id,workspace_id,quotation_id,content,created_at)
            select gen_random_uuid(),workspace_id,id,'assumption:'||id,created_at from app.quotation q
            where project_id=? and not exists(select 1 from app.quotation_assumption a where a.quotation_id=q.id)
            """,
                projectId);
        jdbc.update(
                """
            insert into app.quotation_evidence(id,workspace_id,quotation_id,source_type,source_reference,title,excerpt,retrieved_at,created_at)
            select gen_random_uuid(),workspace_id,id,'USER_TEMPLATE','fixture:'||id,'Synthetic','evidence:'||id,created_at,created_at from app.quotation q
            where project_id=? and not exists(select 1 from app.quotation_evidence e where e.quotation_id=q.id)
            """,
                projectId);
        jdbc.update(
                """
            insert into app.quotation_item(id,workspace_id,quotation_id,title,quantity,unit,unit_rate,subtotal,discount_rate,discount_amount,total,assumption_id,evidence_id,sort_order,created_at)
            select gen_random_uuid(),q.workspace_id,q.id,'Assumption item',1,'FIXED',100,100,0,0,100,a.id,null,0,q.created_at
            from app.quotation q join app.quotation_assumption a on a.quotation_id=q.id where q.project_id=?
              and not exists(select 1 from app.quotation_item i where i.quotation_id=q.id and i.sort_order=0)
            """,
                projectId);
        jdbc.update(
                """
            insert into app.quotation_item(id,workspace_id,quotation_id,title,quantity,unit,unit_rate,subtotal,discount_rate,discount_amount,total,assumption_id,evidence_id,sort_order,created_at)
            select gen_random_uuid(),q.workspace_id,q.id,'Evidence item',1,'FIXED',100,100,0,0,100,null,e.id,1,q.created_at
            from app.quotation q join app.quotation_evidence e on e.quotation_id=q.id where q.project_id=?
              and not exists(select 1 from app.quotation_item i where i.quotation_id=q.id and i.sort_order=1)
            """,
                projectId);
    }

    private static void assertStatus(int status, Runnable action) {
        assertThatThrownBy(action::run)
                .isInstanceOfSatisfying(
                        ResponseStatusException.class,
                        error -> assertThat(error.getStatusCode().value()).isEqualTo(status));
    }
}
