package com.freelanceops.backend.integration;

import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView;
import com.freelanceops.backend.domain.agentrun.entity.AgentRunEntity;
import com.freelanceops.backend.domain.agentrun.model.AgentRunStatus;
import com.freelanceops.backend.domain.agentrun.model.Provider;
import com.freelanceops.backend.domain.agentrun.repository.AgentRunRepository;
import com.freelanceops.backend.domain.agentrun.service.AgentRunGatewayService;
import com.freelanceops.backend.domain.analysisdecision.dto.request.ConfirmAnalysisDecisionRequest;
import com.freelanceops.backend.domain.analysisdecision.dto.request.CreateAnalysisDecisionRequest;
import com.freelanceops.backend.domain.analysisdecision.dto.request.ReviseAnalysisDecisionRequest;
import com.freelanceops.backend.domain.analysisdecision.service.AnalysisDecisionService;
import com.freelanceops.backend.domain.workspace.service.WorkspaceProvisioningService;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.web.server.ResponseStatusException;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Real Flyway/JPA/RBAC and immutable decisions, synthetic Agent results only. */
@Testcontainers(disabledWithoutDocker = true)
@SpringBootTest(properties = {"app.environment=test", "spring.flyway.create-schemas=true",
    "agent.command-dispatch-enabled=false", "agent.reconciliation-enabled=false", "app.rate-limit.enabled=false"})
class AnalysisDecisionPostgresTest {
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
    @Autowired AnalysisDecisionService service;
    @MockitoBean AgentRunGatewayService gateway;
    UUID user, workspace, project, runId;

    @BeforeEach void setup() {
        user = UUID.randomUUID();
        jdbc.update("insert into app.user_account(id,external_subject,email,status) values (?,?,?,'ACTIVE')", user, user.toString(), user + "@example.invalid");
        workspace = provisioning.create(user, "Decision fixture", "decision-" + UUID.randomUUID()).workspaceId();
        project = UUID.randomUUID();
        jdbc.update("insert into app.project(id,workspace_id,title,requirement_text,currency,status,created_by) values (?,?,'Fixture','Original request','KRW','LEAD',?)", project, workspace, user);
        runId = UUID.randomUUID();
        var run = new AgentRunEntity(runId, workspace, project, UUID.randomUUID(), user, Provider.OPENAI, "fixture", AgentRunStatus.COMPLETED, Instant.now());
        run.bindProjectSource(0, "PROJECT_ANALYSIS"); runs.saveAndFlush(run);
        appendSource(runId, "RUN_INPUT", "Original request");
        var drafts = List.of(draft("LEAN"), draft("RECOMMENDED"), draft("EXPANDED"));
        when(gateway.get(eq(user), eq(workspace), eq(runId), anyString())).thenReturn(new AgentRunView(runId, AgentRunStatus.COMPLETED, null, null,
            new AgentRunView.AgentRunResult("Summary", List.of("Unanswered?"), List.of(), drafts.get(1), drafts), null, null, null, Instant.now()));
    }

    @Test void selectionRevisionConfirmationReloadAndRetriesKeepExactSnapshots() {
        var input = new CreateAnalysisDecisionRequest(UUID.randomUUID(), runId, 0, List.of(runId + ":LEAN", runId + ":EXPANDED"));
        var draft = service.create(user, workspace, project, input);
        assertThat(service.create(user, workspace, project, input).id()).isEqualTo(draft.id());
        assertThat(service.get(user, workspace, project, draft.id()).sourceOpinions()).isEqualTo(draft.sourceOpinions());
        var revisionInput = new ReviseAnalysisDecisionRequest(UUID.randomUUID(), draft.contentHash(), "Choose core scope. Unanswered: client assets.");
        var revision = service.revise(user, workspace, project, draft.id(), revisionInput);
        assertThat(service.revise(user, workspace, project, draft.id(), revisionInput).id()).isEqualTo(revision.id());
        assertStatus(409, () -> service.confirm(user, workspace, project, draft.id(), confirm(draft.contentHash())));
        var confirmed = service.confirm(user, workspace, project, revision.id(), confirm(revision.contentHash()));
        assertThat(service.confirm(user, workspace, project, revision.id(), confirm(revision.contentHash()))).isEqualTo(confirmed);
        assertThat(service.getConfirmed(user, workspace, project, confirmed.id()).originalBodyText()).isEqualTo(draft.bodyText());
        assertThat(service.getLatestConfirmed(user, workspace, project).orElseThrow().id()).isEqualTo(confirmed.id());
        assertThat(jdbc.queryForObject("select count(*) from app.analysis_decision where project_id=?", Integer.class, project)).isEqualTo(2);
        assertThat(jdbc.queryForObject("select jsonb_array_length(source_opinions) from app.analysis_decision where id=?", Integer.class, confirmed.id())).isEqualTo(2);
    }

    @Test void databaseRejectsMutationOfDraftAndConfirmedBodiesAndDirectConfirmedInsertion() {
        var draft = service.create(user, workspace, project, new CreateAnalysisDecisionRequest(UUID.randomUUID(), runId, 0, List.of(runId + ":LEAN")));
        assertThatThrownBy(() -> jdbc.update("update app.analysis_decision set body_text='Altered without revision' where id=?", draft.id()))
            .isInstanceOf(org.springframework.dao.DataAccessException.class);
        var confirmed = service.confirm(user, workspace, project, draft.id(), confirm(draft.contentHash()));
        assertThatThrownBy(() -> jdbc.update("update app.analysis_decision set source_summary='Forged provenance' where id=?", confirmed.id()))
            .isInstanceOf(org.springframework.dao.DataAccessException.class);
        assertThatThrownBy(() -> jdbc.update("update app.analysis_decision set status='DRAFT',confirmed_by=null,confirmed_at=null where id=?", confirmed.id()))
            .isInstanceOf(org.springframework.dao.DataAccessException.class);
        assertThatThrownBy(() -> jdbc.update("insert into app.analysis_decision select * from app.analysis_decision where id=?", confirmed.id()))
            .isInstanceOf(org.springframework.dao.DataAccessException.class)
            .hasMessageContaining("review drafts");
        assertThat(service.getConfirmed(user, workspace, project, confirmed.id()).bodyText()).isEqualTo(draft.bodyText());
    }

    @Test void changedSourceAndCrossScopeCannotBeConfirmedOrRead() {
        var draft = service.create(user, workspace, project, new CreateAnalysisDecisionRequest(UUID.randomUUID(), runId, 0, List.of(runId + ":RECOMMENDED")));
        jdbc.update("update app.project set version=version+1,requirement_text='Changed scope' where id=?", project);
        assertStatus(409, () -> service.confirm(user, workspace, project, draft.id(), confirm(draft.contentHash())));
        assertStatus(404, () -> service.get(user, workspace, UUID.randomUUID(), draft.id()));
        assertStatus(404, () -> service.get(UUID.randomUUID(), workspace, project, draft.id()));
        assertThat(jdbc.queryForObject("select status from app.analysis_decision where id=?", String.class, draft.id())).isEqualTo("DRAFT");
        jdbc.update("delete from app.project where id=?", project);
        assertThat(jdbc.queryForObject("select count(*) from app.analysis_decision where id=?", Integer.class, draft.id())).isZero();
    }

    @Test void ownClarificationIsPreservedButNewConfirmationOrAnotherRunsAnswerRejectsStaleResults() {
        appendSource(runId, "USER_CLARIFICATION", "Own answer included in the run");
        var draft = service.create(user, workspace, project, new CreateAnalysisDecisionRequest(UUID.randomUUID(), runId, 0, List.of(runId + ":LEAN")));
        assertThat(draft.sourceMessages()).anyMatch(source -> source.content().equals("Own answer included in the run"));
        appendSource(UUID.randomUUID(), "USER_CLARIFICATION", "Another later answer");
        assertStatus(409, () -> service.confirm(user, workspace, project, draft.id(), confirm(draft.contentHash())));
        assertThat(jdbc.queryForObject("select version from app.project where id=?", Long.class, project)).isZero();
        appendSource(null, "REQUIREMENT_CONFIRMATION", "New confirmed feature scope");
        assertStatus(409, () -> service.create(user, workspace, project, new CreateAnalysisDecisionRequest(UUID.randomUUID(), runId, 0, List.of(runId + ":RECOMMENDED"))));
    }

    private void appendSource(UUID sourceRun, String kind, String content) {
        jdbc.update("insert into app.source_message(workspace_id,project_id,run_id,event_key,kind,content,created_by) values (?,?,?,?,?,?,?)",
            workspace, project, sourceRun, "fixture:" + UUID.randomUUID(), kind, content, user);
    }

    private AgentRunView.QuotationDraft draft(String scenario) {
        return new AgentRunView.QuotationDraft(scenario, List.of(new AgentRunView.QuotationDraftItem("Task", "Original scope", 1, "DAY", null,
            new AgentRunView.QuotationDraftBasis("ASSUMPTION", "Needs client confirmation", null, null))),
            new AgentRunView.PetPerspective(scenario + " proposal", "Reason", "Tradeoff"));
    }
    private ConfirmAnalysisDecisionRequest confirm(String hash) { return new ConfirmAnalysisDecisionRequest(hash, "CONFIRM_ANALYSIS_DECISION"); }
    private void assertStatus(int expected, Runnable call) { assertThatThrownBy(call::run).isInstanceOfSatisfying(ResponseStatusException.class, error -> assertThat(error.getStatusCode().value()).isEqualTo(expected)); }
}
