package com.freelanceops.backend.domain.agentrun.service;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.freelanceops.backend.domain.agentrun.dto.PetConversation;
import com.freelanceops.backend.domain.agentrun.dto.PetProfile;
import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView;
import com.freelanceops.backend.domain.agentrun.entity.AgentRunEntity;
import com.freelanceops.backend.domain.agentrun.model.AgentRunStatus;
import com.freelanceops.backend.domain.project.entity.ProjectEntity;
import com.freelanceops.backend.domain.project.repository.ProjectRepository;
import com.freelanceops.backend.domain.workspace.policy.MembershipPermissions;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import com.freelanceops.backend.domain.workspace.repository.WorkspacePermissionReader;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import tools.jackson.databind.ObjectMapper;

class ProjectPetConversationServiceTest {
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final CustomAgentPetService pets = mock(CustomAgentPetService.class);
    private final WorkspacePermissionReader permissions = mock(WorkspacePermissionReader.class);
    private final ProjectRepository projects = mock(ProjectRepository.class);
    private final ObjectMapper mapper = new ObjectMapper();
    private final ProjectPetConversationService service =
            new ProjectPetConversationService(jdbc, mapper, pets, permissions, projects);
    private final UUID user = UUID.randomUUID(), workspace = UUID.randomUUID(), project = UUID.randomUUID();
    private final List<UUID> ids = List.of(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID());
    private final AgentRunView.QuotationDraft draft = new AgentRunView.QuotationDraft("RECOMMENDED", List.of());
    private ProjectPetConversationService.View stored;

    @BeforeEach
    void setup() {
        membership(Set.of(PermissionCode.PROJECT_READ, PermissionCode.AGENT_RUN,
                PermissionCode.QUOTATION_READ, PermissionCode.QUOTATION_WRITE));
        when(projects.findByIdAndWorkspaceId(project, workspace)).thenReturn(Optional.of(mock(ProjectEntity.class)));
        when(projects.findByIdAndWorkspaceIdForUpdate(project, workspace)).thenReturn(Optional.of(mock(ProjectEntity.class)));
        var owned = ids.stream().map(id -> new CustomAgentPetService.Pet(id,
                new PetProfile("RECOMMENDED", "동료", "cat", "peach", "none", "WARM",
                        "BALANCED", "QUALITY", "BALANCED", id, "GENERAL", "AUTO", null), false, 1)).toList();
        when(pets.list(user, workspace)).thenReturn(new CustomAgentPetService.Collection(
                owned, ids.getFirst(), 8, 24, 500, 6, "MODEL_PIXEL", false));
        when(jdbc.query(contains("project_pet_conversation"), any(RowMapper.class), eq(workspace), eq(project), eq(user)))
                .thenAnswer(invocation -> stored == null ? List.of() : List.of(stored));
        when(jdbc.query(contains("project_pet_turn"), any(RowMapper.class), eq(workspace), eq(project), eq(user)))
                .thenAnswer(invocation -> new ArrayList<>());
        when(jdbc.queryForObject(contains("count(*)"), eq(Integer.class), eq(project), eq(workspace))).thenReturn(0);
    }

    private void membership(Set<PermissionCode> codes) {
        when(permissions.findActiveMembership(user, workspace))
                .thenReturn(Optional.of(new MembershipPermissions(UUID.randomUUID(), codes)));
    }

    @Test
    void defaultsUseOnlyTheActiveOwnedSelection() {
        var view = service.get(user, workspace, project);
        assertThat(view.version()).isZero();
        assertThat(view.settings().participantPetIds()).containsExactly(ids.getFirst());
    }

    @Test
    void threePetsProduceAnImmutableServerResolvedContext() {
        stored = new ProjectPetConversationService.View(
                new ProjectPetConversationService.Settings(true, true, ids, draft, UUID.randomUUID()), 4);
        var snapshot = service.snapshot(user, workspace, project, new PetConversation.Command(4, ids.get(1)));
        assertThat(snapshot.profiles()).extracting(PetProfile::petId).containsExactlyElementsOf(ids);
        assertThat(snapshot.context().recipientPetId()).isEqualTo(ids.get(1));
        assertThat(snapshot.context().acceptedDraft()).isEqualTo(draft);
    }

    @Test
    void settingsVersionMustMatchBeforeAnyWrite() {
        assertThatThrownBy(() -> service.update(user, workspace, project,
                new ProjectPetConversationService.Update(true, true, ids, 1)))
                .hasMessageContaining("CONVERSATION_SETTINGS_CHANGED");
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }

    @Test
    void overCapacityDuplicatesAndUnownedPetsCannotBeSelected() {
        for (var invalid : List.of(List.of(ids.getFirst(), ids.getFirst()),
                List.of(ids.getFirst(), ids.get(1), ids.get(2), UUID.randomUUID()), List.of(UUID.randomUUID()))) {
            assertThatThrownBy(() -> service.update(user, workspace, project,
                    new ProjectPetConversationService.Update(true, true, invalid, 0)));
        }
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }

    @Test
    void activeRunMustBeAcknowledgedAsStoppedBeforeChangingTheTeam() {
        when(jdbc.queryForObject(contains("count(*)"), eq(Integer.class), eq(project), eq(workspace))).thenReturn(1);
        assertThatThrownBy(() -> service.update(user, workspace, project,
                new ProjectPetConversationService.Update(false, false, ids, 0)))
                .hasMessageContaining("CONVERSATION_RUN_ACTIVE");
    }

    @Test
    void missingMembershipOrCrossWorkspaceProjectNeverReadsConversationData() {
        when(projects.findByIdAndWorkspaceId(project, workspace)).thenReturn(Optional.empty());
        assertThatThrownBy(() -> service.get(user, workspace, project)).hasMessageContaining("404");
        verifyNoInteractions(jdbc);
        when(permissions.findActiveMembership(user, workspace)).thenReturn(Optional.empty());
        assertThatThrownBy(() -> service.get(user, workspace, project)).hasMessageContaining("404");
    }

    @Test
    void revokedQuoteReadHidesTheAcceptedDraftAndRatesFromBothClientAndModel() {
        stored = new ProjectPetConversationService.View(
                new ProjectPetConversationService.Settings(true, true, ids, draft, UUID.randomUUID()), 4);
        membership(Set.of(PermissionCode.PROJECT_READ, PermissionCode.AGENT_RUN));
        assertThat(service.get(user, workspace, project).settings().acceptedDraft()).isNull();
        var context = service.snapshot(user, workspace, project, new PetConversation.Command(4, null)).context();
        assertThat(context.acceptedDraft()).isNull();
        assertThat(context.rateCards()).isEmpty();
        verify(jdbc, never()).queryForList(anyString(), any(Object[].class));
    }

    @Test
    void disablingPetsRetainsTheAcceptedDraftAndIncrementsTheVersion() {
        stored = new ProjectPetConversationService.View(
                new ProjectPetConversationService.Settings(true, true, ids, draft, UUID.randomUUID()), 4);
        var next = service.update(user, workspace, project,
                new ProjectPetConversationService.Update(false, false, ids, 4));
        assertThat(next.version()).isEqualTo(5);
        assertThat(next.settings().acceptedDraft()).isEqualTo(draft);
        assertThat(next.settings().petMode()).isFalse();
        verify(jdbc).update(contains("ON CONFLICT"), eq(workspace), eq(project), eq(user), anyString(), eq(5L));
    }

    @Test
    void acceptingOnlyCopiesAnOwnedCompletedServerProposal() {
        var run = mock(AgentRunEntity.class);
        UUID runId = UUID.randomUUID();
        when(run.id()).thenReturn(runId);
        when(run.projectId()).thenReturn(project);
        when(run.workspaceId()).thenReturn(workspace);
        when(run.initiatedBy()).thenReturn(user);
        var message = new AgentRunView.PetMessage(UUID.randomUUID(), null, null, null, "공개 응답", List.of(), List.of());
        var result = new AgentRunView.AgentRunResult("응답", List.of(), List.of(), draft, List.of(draft), List.of(), List.of(message));
        var view = new AgentRunView(runId, AgentRunStatus.COMPLETED, null, null, result, null, null, null, Instant.now());
        var next = service.accept(user, workspace, project, new ProjectPetConversationService.Accept(runId, 0), run, view);
        assertThat(next.settings().acceptedDraft()).isSameAs(draft);
        assertThat(next.settings().draftSourceRunId()).isEqualTo(runId);
        when(run.initiatedBy()).thenReturn(UUID.randomUUID());
        assertThatThrownBy(() -> service.accept(user, workspace, project,
                new ProjectPetConversationService.Accept(runId, 0), run, view)).hasMessageContaining("404");
    }

}
