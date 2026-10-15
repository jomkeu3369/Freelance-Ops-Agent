package com.freelanceops.backend.domain.knowledge.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.freelanceops.backend.domain.knowledge.dto.request.CreateDocumentRequest;
import com.freelanceops.backend.domain.knowledge.dto.request.DocumentChunkRequest;
import com.freelanceops.backend.domain.knowledge.model.KnowledgeSourceType;
import com.freelanceops.backend.domain.knowledge.repository.DocumentChunkRepository;
import com.freelanceops.backend.domain.knowledge.repository.DocumentRepository;
import com.freelanceops.backend.domain.memory.service.ProjectMemoryService;
import com.freelanceops.backend.domain.project.repository.ProjectRepository;
import com.freelanceops.backend.domain.workspace.policy.AuthorizationDecision;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import com.freelanceops.backend.domain.workspace.service.WorkspaceAuthorizationService;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.UUID;

@ExtendWith(MockitoExtension.class)
class DocumentServiceTest {
    @Mock private DocumentRepository documentRepository;
    @Mock private DocumentChunkRepository chunkRepository;
    @Mock private RaptorIndexTransactions raptorIndexTransactions;
    @Mock private WorkspaceAuthorizationService authorizationService;

    @Test
    void duplicateWorkspaceContentIsReportedAsAConflict() {
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        when(authorizationService.authorize(userId, workspaceId, PermissionCode.DOCUMENT_WRITE))
                .thenReturn(AuthorizationDecision.ALLOWED);
        when(documentRepository.saveAndFlush(any()))
                .thenThrow(
                        new DataIntegrityViolationException(
                                "constraint uq_document_workspace_hash"));
        CreateDocumentRequest request =
                new CreateDocumentRequest(
                        KnowledgeSourceType.POLICY,
                        "정책",
                        null,
                        null,
                        null,
                        null,
                        null,
                        List.of(new DocumentChunkRequest("동일한 본문", null, null, null, null)));

        assertThatThrownBy(() -> service().create(userId, workspaceId, request))
                .isInstanceOfSatisfying(
                        ResponseStatusException.class,
                        error -> assertThat(error.getStatusCode().value()).isEqualTo(409));
        verify(raptorIndexTransactions).invalidateActiveSnapshot(workspaceId);
    }

    private DocumentService service() {
        return new DocumentService(
                documentRepository,
                chunkRepository,
                authorizationService,
                raptorIndexTransactions,
                org.mockito.Mockito.mock(ProjectMemoryService.class),
                org.mockito.Mockito.mock(ProjectRepository.class));
    }
}
