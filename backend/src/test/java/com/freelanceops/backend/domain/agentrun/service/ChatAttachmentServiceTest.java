package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.client.AttachmentReaderClient;
import com.freelanceops.backend.domain.agentrun.dto.AttachmentText;
import com.freelanceops.backend.domain.agentrun.security.DelegationTokenIssuer;
import com.freelanceops.backend.domain.project.entity.ProjectEntity;
import com.freelanceops.backend.domain.project.repository.ProjectRepository;
import com.freelanceops.backend.domain.workspace.policy.MembershipPermissions;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import com.freelanceops.backend.domain.workspace.repository.WorkspacePermissionReader;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class ChatAttachmentServiceTest {
    final UUID user = UUID.randomUUID(), workspace = UUID.randomUUID(), project = UUID.randomUUID(), id = UUID.randomUUID();
    final WorkspacePermissionReader permissions = mock(WorkspacePermissionReader.class);
    final ProjectRepository projects = mock(ProjectRepository.class);
    final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    final AttachmentReaderClient reader = mock(AttachmentReaderClient.class);
    final DelegationTokenIssuer tokens = mock(DelegationTokenIssuer.class);
    final ObjectMapper mapper = new ObjectMapper();
    final ChatAttachmentService service = new ChatAttachmentService(permissions, projects, jdbc, mapper, reader, tokens);
    final MockMultipartFile file = new MockMultipartFile("file", "data.txt", "text/plain", "synthetic".getBytes());

    void authorize() {
        when(permissions.findActiveMembership(user, workspace)).thenReturn(Optional.of(new MembershipPermissions(UUID.randomUUID(), Set.of(PermissionCode.AGENT_RUN, PermissionCode.PROJECT_READ))));
        when(projects.findByIdAndWorkspaceIdForUpdate(project, workspace)).thenReturn(Optional.of(mock(ProjectEntity.class)));
    }
    AttachmentText text(String contents) {
        return new AttachmentText("data.txt", "text/plain", 9, "a".repeat(64), "COMPLETE", contents, "", "utf-8", null, 1);
    }
    @Test void noMembershipAndMissingPermissionNeverReadBytesOrStore() {
        assertEquals(404, assertThrows(ResponseStatusException.class, () -> service.upload(user, workspace, project, file, "auto", "auto")).getStatusCode().value());
        when(permissions.findActiveMembership(user, workspace)).thenReturn(Optional.of(new MembershipPermissions(UUID.randomUUID(), Set.of(PermissionCode.PROJECT_READ))));
        assertEquals(403, assertThrows(ResponseStatusException.class, () -> service.upload(user, workspace, project, file, "auto", "auto")).getStatusCode().value());
        verifyNoInteractions(reader, jdbc);
    }
    @Test void foreignProjectReturns404BeforeReader() {
        authorize();
        when(projects.findByIdAndWorkspaceIdForUpdate(project, workspace)).thenReturn(Optional.empty());
        assertEquals(404, assertThrows(ResponseStatusException.class, () -> service.upload(user, workspace, project, file, "auto", "auto")).getStatusCode().value());
        verifyNoInteractions(reader, jdbc);
    }
    @Test void sizeAndFilenameFailBeforeReader() {
        authorize();
        assertThrows(ResponseStatusException.class, () -> service.upload(user, workspace, project, new MockMultipartFile("file", "../x.txt", "text/plain", new byte[10]), "auto", "auto"));
        assertEquals(413, assertThrows(ResponseStatusException.class, () -> service.upload(user, workspace, project, new MockMultipartFile("file", "x.txt", "text/plain", new byte[2097153]), "auto", "auto")).getStatusCode().value());
        verifyNoInteractions(reader, jdbc);
    }
    @Test void uploadsStoreOnlyExtractionWithExpiryAndOwnerScope() {
        authorize();
        when(reader.read(any(), any())).thenReturn(text("synthetic"));
        var preview = service.upload(user, workspace, project, file, "auto", "auto");
        assertTrue(preview.expiresAt().isAfter(java.time.Instant.now().plusSeconds(1700)));
        verify(jdbc).update(contains("INSERT INTO app.chat_attachment"), eq(preview.id()), eq(workspace), eq(project), eq(user), eq(mapper.writeValueAsString(text("synthetic"))), any(java.sql.Timestamp.class));
    }
    @Test void expiredOrForeignReceiptIsUnavailableAndNeverFallsBack() {
        when(jdbc.queryForList(anyString(), eq(String.class), eq(id), eq(workspace), eq(project), eq(user))).thenReturn(List.of());
        assertEquals(410, assertThrows(ResponseStatusException.class, () -> service.resolve(user, workspace, project, List.of(id))).getStatusCode().value());
        verify(jdbc).queryForList(contains("expires_at > CURRENT_TIMESTAMP"), eq(String.class), eq(id), eq(workspace), eq(project), eq(user));
    }
    @Test void aggregateAndDuplicateLimitsNeverSilentlyTruncate() {
        assertThrows(ResponseStatusException.class, () -> service.resolve(user, workspace, project, List.of(id, id)));
        UUID second = UUID.randomUUID();
        when(jdbc.queryForList(anyString(), eq(String.class), any(), eq(workspace), eq(project), eq(user))).thenReturn(List.of(mapper.writeValueAsString(text("x".repeat(21000)))));
        assertEquals(413, assertThrows(ResponseStatusException.class, () -> service.resolve(user, workspace, project, List.of(id, second))).getStatusCode().value());
    }
    @Test void deleteAndConsumeAlwaysUseFourPartOwnershipScope() {
        authorize();
        service.delete(user, workspace, project, id);
        service.consume(user, workspace, project, List.of(id));
        verify(jdbc, times(2)).update(contains("id = ? AND workspace_id = ? AND project_id = ? AND owner_id = ?"), eq(id), eq(workspace), eq(project), eq(user));
    }
}
