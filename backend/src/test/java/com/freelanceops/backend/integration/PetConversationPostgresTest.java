package com.freelanceops.backend.integration;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.freelanceops.backend.domain.agentrun.dto.PetConversation;
import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView;
import com.freelanceops.backend.domain.agentrun.entity.AgentRunEntity;
import com.freelanceops.backend.domain.agentrun.service.CustomAgentPetService;
import com.freelanceops.backend.domain.agentrun.service.ProjectPetConversationService;
import com.freelanceops.backend.domain.project.entity.ProjectEntity;
import com.freelanceops.backend.domain.project.repository.ProjectRepository;
import com.freelanceops.backend.domain.workspace.policy.MembershipPermissions;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import com.freelanceops.backend.domain.workspace.repository.WorkspacePermissionReader;
import java.util.*;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;
import tools.jackson.databind.ObjectMapper;

@Testcontainers
class PetConversationPostgresTest {
    @Container
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer(
            DockerImageName.parse("pgvector/pgvector:pg17").asCompatibleSubstituteFor("postgres"));

    @Test
    void upgradePersistsScopedSettingsAndCompletedMessagesWithoutRegressingTheTurn() {
        var flyway = Flyway.configure().dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .locations("classpath:db/migration").schemas("app").defaultSchema("app").createSchemas(true).target("53").load();
        flyway.migrate();
        flyway.validate();
        var jdbc = new JdbcTemplate(new DriverManagerDataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()));
        UUID user = UUID.randomUUID(), other = UUID.randomUUID(), workspace = UUID.randomUUID(), project = UUID.randomUUID(), run = UUID.randomUUID();
        for (UUID id : List.of(user, other)) jdbc.update(
                "INSERT INTO app.user_account(id,external_subject,email,status) VALUES (?,?,?,'ACTIVE')", id, id.toString(), id + "@example.invalid");
        jdbc.update("INSERT INTO app.workspace(id,name,slug,status,created_by) VALUES (?,'Conversation',?,'ACTIVE',?)", workspace, workspace.toString(), user);
        jdbc.update("INSERT INTO app.project(id,workspace_id,title,requirement_text,currency,created_by) VALUES (?,?,'Project','Original','KRW',?)", project, workspace, user);
        jdbc.update("INSERT INTO app.agent_run(id,workspace_id,project_id,thread_id,initiated_by,provider,model,status) VALUES (?,?,?,?,?,'OPENAI','synthetic','COMPLETED')", run, workspace, project, UUID.randomUUID(), user);
        var latest = Flyway.configure().dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .locations("classpath:db/migration").schemas("app").defaultSchema("app").load();
        assertThat(latest.migrate().migrationsExecuted).isEqualTo(1);
        latest.validate();
        assertThat(jdbc.queryForObject("SELECT status FROM app.agent_run WHERE id=?", String.class, run)).isEqualTo("COMPLETED");
        assertThat(jdbc.update("UPDATE app.agent_run SET status='PARTIAL' WHERE id=?", run)).isEqualTo(1);
        assertThat(latest.migrate().migrationsExecuted).isZero();
        var pets = mock(CustomAgentPetService.class);
        when(pets.list(any(), eq(workspace))).thenReturn(new CustomAgentPetService.Collection(List.of(), null, 8, 24, 500, 6, "MODEL_PIXEL", false));
        var permissions = mock(WorkspacePermissionReader.class);
        when(permissions.findActiveMembership(any(), eq(workspace))).thenReturn(Optional.of(new MembershipPermissions(UUID.randomUUID(),
                Set.of(PermissionCode.PROJECT_READ, PermissionCode.AGENT_RUN, PermissionCode.QUOTATION_READ))));
        var projects = mock(ProjectRepository.class);
        when(projects.findByIdAndWorkspaceId(project, workspace)).thenReturn(Optional.of(mock(ProjectEntity.class)));
        when(projects.findByIdAndWorkspaceIdForUpdate(project, workspace)).thenReturn(Optional.of(mock(ProjectEntity.class)));
        var service = new ProjectPetConversationService(jdbc, new ObjectMapper(), pets, permissions, projects);
        assertThat(service.update(user, workspace, project, new ProjectPetConversationService.Update(false, false, List.of(), 0)).version()).isEqualTo(1);
        assertThat(service.get(user, workspace, project).settings().debateEnabled()).isFalse();
        assertThat(service.get(other, workspace, project).version()).isZero();
        service.recordStart(user, workspace, project, run, "예약 범위를 정하자");
        var message = new AgentRunView.PetMessage(UUID.randomUUID(), null, null, null, "확인이 필요한 범위입니다.", List.of(), List.of());
        var entity = mock(AgentRunEntity.class);
        when(entity.id()).thenReturn(run);
        var result = new AgentRunView.AgentRunResult("응답", List.of(), List.of(), null, List.of(), List.of(), List.of(message));
        service.recordResult(entity, new AgentRunView(run, com.freelanceops.backend.domain.agentrun.model.AgentRunStatus.COMPLETED,
                null, null, result, null, null, null, java.time.Instant.now()));
        var context = service.snapshot(user, workspace, project, new PetConversation.Command(1, null)).context();
        assertThat(context.history()).hasSize(1);
        assertThat(context.history().getFirst().messages()).containsExactly(message);
        assertThat(service.snapshot(other, workspace, project, new PetConversation.Command(0, null)).context().history()).isEmpty();
        when(permissions.findActiveMembership(any(), eq(workspace))).thenReturn(Optional.of(new MembershipPermissions(UUID.randomUUID(),
                Set.of(PermissionCode.PROJECT_READ, PermissionCode.AGENT_RUN))));
        assertThat(service.snapshot(user, workspace, project, new PetConversation.Command(1, null))
                .context().history().getFirst().messages()).isEmpty();
        jdbc.update("DELETE FROM app.project WHERE id = ?", project);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM app.project_pet_conversation", Integer.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM app.project_pet_turn", Integer.class)).isZero();
    }
}
