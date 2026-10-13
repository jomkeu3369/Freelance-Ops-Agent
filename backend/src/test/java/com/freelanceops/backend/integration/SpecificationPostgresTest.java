package com.freelanceops.backend.integration;

import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView;
import com.freelanceops.backend.domain.agentrun.entity.AgentRunEntity;
import com.freelanceops.backend.domain.agentrun.model.AgentRunStatus;
import com.freelanceops.backend.domain.agentrun.model.Provider;
import com.freelanceops.backend.domain.agentrun.repository.AgentRunRepository;
import com.freelanceops.backend.domain.agentrun.service.AgentRunGatewayService;
import com.freelanceops.backend.domain.analysisdecision.dto.request.*;
import com.freelanceops.backend.domain.analysisdecision.dto.response.AnalysisDecisionResponse;
import com.freelanceops.backend.domain.analysisdecision.service.AnalysisDecisionService;
import com.freelanceops.backend.domain.knowledge.client.RaptorBuildClient;
import com.freelanceops.backend.domain.knowledge.dto.request.KnowledgeSearchRequest;
import com.freelanceops.backend.domain.knowledge.service.KnowledgeService;
import com.freelanceops.backend.domain.specification.dto.request.*;
import com.freelanceops.backend.domain.specification.dto.response.SpecificationResponse;
import com.freelanceops.backend.domain.specification.service.SpecificationService;
import com.freelanceops.backend.domain.specification.service.SpecificationText;
import com.freelanceops.backend.domain.workspace.service.WorkspaceProvisioningService;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.text.PDFTextStripper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.web.server.ResponseStatusException;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Real V50/V51/Flyway/JPA/RBAC and PDF bytes; no paid provider or external customer transmission. */
@Testcontainers(disabledWithoutDocker = true)
@SpringBootTest(properties = {"app.environment=test", "spring.flyway.create-schemas=true",
    "agent.command-dispatch-enabled=false", "agent.task-command-dispatch-enabled=false",
    "agent.reconciliation-enabled=false", "app.notices.dispatch-enabled=false", "app.rate-limit.enabled=false"})
@DirtiesContext
class SpecificationPostgresTest {
    @Container static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer(
        DockerImageName.parse("pgvector/pgvector:pg17").asCompatibleSubstituteFor("postgres"));
    @DynamicPropertySource static void database(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }
    @Autowired JdbcTemplate jdbc;
    @Autowired WorkspaceProvisioningService provisioning;
    @Autowired AgentRunRepository runs;
    @Autowired AnalysisDecisionService decisions;
    @Autowired SpecificationService specifications;
    @Autowired KnowledgeService knowledge;
    @MockitoBean AgentRunGatewayService gateway;
    @MockitoBean RaptorBuildClient paidIndex;
    UUID actor, workspace, projectId, runId;

    @BeforeEach void setup() {
        actor = UUID.randomUUID();
        jdbc.update("insert into app.user_account(id,external_subject,email,status) values (?,?,?,'ACTIVE')", actor, actor.toString(), actor + "@example.invalid");
        workspace = provisioning.create(actor, "Specification fixture", "spec-" + UUID.randomUUID()).workspaceId();
        projectId = UUID.randomUUID();
        jdbc.update("insert into app.project(id,workspace_id,title,requirement_text,currency,status,created_by) values (?,?,'한글 명세','원문 요구사항','KRW','LEAD',?)", projectId, workspace, actor);
        runId = UUID.randomUUID();
        var run = new AgentRunEntity(runId, workspace, projectId, UUID.randomUUID(), actor, Provider.OPENAI, "fixture", AgentRunStatus.COMPLETED, Instant.now());
        run.bindProjectSource(0, "PROJECT_ANALYSIS"); runs.saveAndFlush(run);
        jdbc.update("insert into app.source_message(workspace_id,project_id,run_id,event_key,kind,content,created_by) values (?,?,?,?,'RUN_INPUT','원문 요구사항',?)",
            workspace, projectId, runId, "run:" + runId, actor);
        var drafts = List.of(draft("LEAN"), draft("RECOMMENDED"), draft("EXPANDED"));
        when(gateway.get(eq(actor), eq(workspace), eq(runId), anyString())).thenReturn(new AgentRunView(runId, AgentRunStatus.COMPLETED, null, null,
            new AgentRunView.AgentRunResult("AI summary", List.of("확인이 필요한 질문"), List.of(), drafts.get(1), drafts), null, null, null, Instant.now()));
    }

    @Test void fullConfirmedFlowPreservesEverySourceAndOnlyFinalTextIsReusable() throws Exception {
        var result = confirmedResult("초기 확정 내용 verified_keyword");
        UUID requestId = UUID.randomUUID();
        var draft = specifications.create(actor, workspace, projectId, new CreateSpecificationRequest(result.id(), requestId));
        assertThat(draft.sourceBodyText()).isEqualTo(result.bodyText());
        assertThat(draft.sourceProvenance().get("originalBodyText")).isEqualTo(result.originalBodyText());
        assertThat(draft.originalSources()).hasSize(2);
        assertThat(draft.createdAt().getNano() % 1000).isZero();
        assertThat(specifications.get(actor, workspace, projectId, draft.id()).createdAt()).isEqualTo(draft.createdAt());
        assertThat(countDocuments()).isZero();
        assertStatus(409, () -> specifications.download(actor, workspace, projectId, draft.id()));
        assertThat(specifications.create(actor, workspace, projectId, new CreateSpecificationRequest(result.id(), requestId)).id()).isEqualTo(draft.id());
        String finalText = "  사용자 최종 확인 verified_keyword <script>literal</script>\n" + "한글 보존 ".repeat(3100) + "\n마지막 확정 기준  ";
        var revisionInput = new ReviseSpecificationRequest(UUID.randomUUID(), draft.contentHash(), "고객 명세서 / 최종", finalText);
        var revision = specifications.revise(actor, workspace, projectId, draft.id(), revisionInput);
        assertThat(specifications.revise(actor, workspace, projectId, draft.id(), revisionInput).id()).isEqualTo(revision.id());
        assertStatus(409, () -> confirm(draft));
        var confirmed = confirm(revision);
        var replay = confirm(revision);
        assertThat(replay.id()).isEqualTo(confirmed.id());
        assertThat(replay.confirmedAt()).isEqualTo(confirmed.confirmedAt());
        assertThat(confirmed.confirmedAt().getNano() % 1000).isZero();
        assertThat(specifications.get(actor, workspace, projectId, confirmed.id()).confirmedAt()).isEqualTo(confirmed.confirmedAt());
        assertThat(confirmed.bodyText()).isEqualTo(finalText);
        assertThat(confirmed.contentHash()).isEqualTo(SpecificationText.hash(finalText));
        assertThat(confirmed.indexStatus()).isEqualTo("KEYWORD_ONLY");
        assertThat(countDocuments()).isOne();
        String stored = jdbc.queryForObject("select string_agg(content, '' order by chunk_index) from app.document_chunk where document_id=?", String.class, confirmed.reusableDocumentId());
        assertThat(stored).isEqualTo(finalText).doesNotContain("EXPANDED public opinion", "RECOMMENDED public opinion", "AI summary");
        assertThat(jdbc.queryForObject("select count(*) from app.document_chunk where document_id=? and embedding is not null", Integer.class, confirmed.reusableDocumentId())).isZero();
        var hits = knowledge.search(actor, workspace, new KnowledgeSearchRequest("verified_keyword", null, 10), projectId, null);
        assertThat(hits).isNotEmpty().allMatch(hit -> hit.documentId().equals(confirmed.reusableDocumentId()));
        assertThat(knowledge.search(actor, workspace, new KnowledgeSearchRequest("verified_keyword", null, 10), UUID.randomUUID(), null)).isEmpty();
        var firstPdf = specifications.download(actor, workspace, projectId, confirmed.id());
        var secondPdf = specifications.download(actor, workspace, projectId, confirmed.id());
        assertThat(firstPdf.bytes()).isEqualTo(secondPdf.bytes());
        assertThat(firstPdf.fileName()).isEqualTo("고객 명세서 _ 최종-v2.pdf");
        try (var pdf = Loader.loadPDF(firstPdf.bytes())) {
            assertThat(new PDFTextStripper().getText(pdf)).contains("사용자 최종 확인", "<script>literal</script>", "마지막 확정 기준", confirmed.contentHash());
            assertThat(pdf.getDocumentInformation().getCustomMetadataValue("ConfirmedAt")).isEqualTo(confirmed.confirmedAt().toString());
        }
        assertThat(specifications.get(actor, workspace, projectId, confirmed.id()).bodyText()).isEqualTo(finalText);
        assertThat(specifications.list(actor, workspace, projectId)).hasSize(2).allMatch(value -> value.sourceCurrent());
        verifyNoInteractions(paidIndex);
    }

    @Test void semanticSourceChangeWithSameProjectVersionInvalidatesReuseButPreservesOldPdf() {
        var result = confirmedResult("확정 내용 semantic_keyword");
        var confirmed = confirm(specifications.create(actor, workspace, projectId, new CreateSpecificationRequest(result.id(), UUID.randomUUID())));
        byte[] oldPdf = specifications.download(actor, workspace, projectId, confirmed.id()).bytes();
        var draft = specifications.revise(actor, workspace, projectId, confirmed.id(), new ReviseSpecificationRequest(UUID.randomUUID(), confirmed.contentHash(), confirmed.title(), "검토 중인 수정본"));
        jdbc.update("insert into app.source_message(workspace_id,project_id,event_key,kind,content,created_by) values (?,?,?,'REQUIREMENT_CONFIRMATION','변경된 확정 범위',?)", workspace, projectId, "new-confirm:" + UUID.randomUUID(), actor);
        assertThat(jdbc.queryForObject("select version from app.project where id=?", Long.class, projectId)).isZero();
        assertThat(specifications.get(actor, workspace, projectId, confirmed.id()).sourceCurrent()).isFalse();
        assertThat(specifications.get(actor, workspace, projectId, confirmed.id()).indexStatus()).isEqualTo("SUPERSEDED");
        assertThat(specifications.list(actor, workspace, projectId)).allMatch(value -> !value.sourceCurrent());
        assertStatus(409, () -> confirm(draft));
        assertStatus(409, () -> specifications.create(actor, workspace, projectId, new CreateSpecificationRequest(result.id(), UUID.randomUUID())));
        assertThat(jdbc.queryForObject("select retrieval_eligible from app.document where id=?", Boolean.class, confirmed.reusableDocumentId())).isFalse();
        assertThat(knowledge.search(actor, workspace, new KnowledgeSearchRequest("semantic_keyword", null, 10), projectId, null)).isEmpty();
        assertThat(specifications.download(actor, workspace, projectId, confirmed.id()).bytes()).isEqualTo(oldPdf);
        verifyNoInteractions(paidIndex);
    }

    @Test void newerConfirmedResultImmediatelySupersedesEarlierSpecificationMemory() {
        var firstResult = confirmedResult("첫 결과 first_keyword");
        var firstSpecification = confirm(specifications.create(actor, workspace, projectId, new CreateSpecificationRequest(firstResult.id(), UUID.randomUUID())));
        var newResult = confirmedResult("두번째 결과 second_keyword");
        assertThat(newResult.id()).isNotEqualTo(firstResult.id());
        assertThat(specifications.get(actor, workspace, projectId, firstSpecification.id()).sourceCurrent()).isFalse();
        assertThat(specifications.get(actor, workspace, projectId, firstSpecification.id()).indexStatus()).isEqualTo("SUPERSEDED");
        assertThat(jdbc.queryForObject("select retrieval_eligible from app.document where id=?", Boolean.class, firstSpecification.reusableDocumentId())).isFalse();
        assertThat(knowledge.search(actor, workspace, new KnowledgeSearchRequest("first_keyword", null, 10), projectId, null)).isEmpty();
        assertStatus(409, () -> specifications.create(actor, workspace, projectId, new CreateSpecificationRequest(firstResult.id(), UUID.randomUUID())));
        var newDraft = specifications.create(actor, workspace, projectId, new CreateSpecificationRequest(newResult.id(), UUID.randomUUID()));
        assertThat(newDraft.revisionNumber()).isEqualTo(2);
        assertThat(newDraft.bodyText()).isEqualTo(newResult.bodyText());
    }

    @Test void parallelConfirmationsCreateOneKeywordDocument() throws Exception {
        var result = confirmedResult("parallel_keyword");
        var draft = specifications.create(actor, workspace, projectId, new CreateSpecificationRequest(result.id(), UUID.randomUUID()));
        try (var pool = Executors.newFixedThreadPool(2)) {
            var first = pool.submit(() -> confirm(draft)); var second = pool.submit(() -> confirm(draft));
            assertThat(first.get(20, TimeUnit.SECONDS).id()).isEqualTo(second.get(20, TimeUnit.SECONDS).id());
        }
        assertThat(countDocuments()).isOne();
    }

    @Test void newConfirmedSpecificationRevisionExcludesOldMemoryAndKeepsExactOldPdf() {
        var result = confirmedResult("old_revision_keyword");
        var first = confirm(specifications.create(actor, workspace, projectId, new CreateSpecificationRequest(result.id(), UUID.randomUUID())));
        byte[] oldPdf = specifications.download(actor, workspace, projectId, first.id()).bytes();
        var draft = specifications.revise(actor, workspace, projectId, first.id(),
            new ReviseSpecificationRequest(UUID.randomUUID(), first.contentHash(), first.title(), "new_revision_keyword 최종 수정"));
        var second = confirm(draft);
        assertThat(second.revisionNumber()).isEqualTo(2);
        assertThat(second.indexStatus()).isEqualTo("KEYWORD_ONLY");
        assertThat(specifications.get(actor, workspace, projectId, first.id()).indexStatus()).isEqualTo("SUPERSEDED");
        assertThat(knowledge.search(actor, workspace, new KnowledgeSearchRequest("old_revision_keyword", null, 10), projectId, null)).isEmpty();
        assertThat(knowledge.search(actor, workspace, new KnowledgeSearchRequest("new_revision_keyword", null, 10), projectId, null))
            .isNotEmpty().allMatch(hit -> hit.documentId().equals(second.reusableDocumentId()));
        assertThat(specifications.download(actor, workspace, projectId, first.id()).bytes()).isEqualTo(oldPdf);
        assertThat(confirm(first).confirmedAt()).isEqualTo(first.confirmedAt());
    }

    @Test void databaseImmutabilityTenantBoundariesAndAggregateDeletionRemainEnforced() {
        var result = confirmedResult("DB-boundary");
        var confirmed = confirm(specifications.create(actor, workspace, projectId, new CreateSpecificationRequest(result.id(), UUID.randomUUID())));
        assertStatus(404, () -> specifications.get(UUID.randomUUID(), workspace, projectId, confirmed.id()));
        assertStatus(404, () -> specifications.get(actor, workspace, UUID.randomUUID(), confirmed.id()));
        assertStatus(404, () -> specifications.download(actor, UUID.randomUUID(), projectId, confirmed.id()));
        assertThatThrownBy(() -> jdbc.update("update app.specification set body_text='tampered' where id=?", confirmed.id())).isInstanceOf(DataAccessException.class);
        assertThatThrownBy(() -> jdbc.update("delete from app.specification where id=?", confirmed.id())).isInstanceOf(DataAccessException.class);
        assertThatThrownBy(() -> jdbc.update("""
            insert into app.specification
            select (jsonb_populate_record(null::app.specification, to_jsonb(source)
                || jsonb_build_object('id', cast(? as text), 'revision_number', 99))).*
            from app.specification source where source.id=?
            """, UUID.randomUUID(), confirmed.id()))
            .isInstanceOf(DataAccessException.class).hasMessageContaining("must begin as a draft");
        jdbc.update("delete from app.project where id=?", projectId);
        assertThat(jdbc.queryForObject("select count(*) from app.specification where project_id=?", Integer.class, projectId)).isZero();
        assertThat(jdbc.queryForObject("select count(*) from app.specification_request where project_id=?", Integer.class, projectId)).isZero();
        assertThat(jdbc.queryForObject("select count(*) from app.document where id=?", Integer.class, confirmed.reusableDocumentId())).isZero();
    }

    private AnalysisDecisionResponse confirmedResult(String text) {
        var draft = decisions.create(actor, workspace, projectId, new CreateAnalysisDecisionRequest(UUID.randomUUID(), runId, 0, List.of(runId + ":LEAN")));
        var edited = decisions.revise(actor, workspace, projectId, draft.id(), new ReviseAnalysisDecisionRequest(UUID.randomUUID(), draft.contentHash(), text));
        return decisions.confirm(actor, workspace, projectId, edited.id(), new ConfirmAnalysisDecisionRequest(edited.contentHash(), "CONFIRM_ANALYSIS_DECISION"));
    }
    private SpecificationResponse confirm(SpecificationResponse value) { return specifications.confirm(actor, workspace, projectId, value.id(), new ConfirmSpecificationRequest(value.contentHash(), "CONFIRM_SPECIFICATION")); }
    private int countDocuments() { return jdbc.queryForObject("select count(*) from app.document where project_id=? and source_specification_id is not null", Integer.class, projectId); }
    private AgentRunView.QuotationDraft draft(String scenario) {
        return new AgentRunView.QuotationDraft(scenario, List.of(new AgentRunView.QuotationDraftItem("기능", "원문 범위", 1, "DAY", null,
            new AgentRunView.QuotationDraftBasis("ASSUMPTION", "고객 확인 필요", null, null))),
            new AgentRunView.PetPerspective(scenario + " public opinion", "선택 이유", "범위 차이"));
    }
    private void assertStatus(int expected, Runnable call) { assertThatThrownBy(call::run).isInstanceOfSatisfying(ResponseStatusException.class, error -> assertThat(error.getStatusCode().value()).isEqualTo(expected)); }
}
