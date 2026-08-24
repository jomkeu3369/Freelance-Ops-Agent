package com.freelanceops.backend.domain.knowledge.service;

import com.freelanceops.backend.domain.knowledge.dto.request.KnowledgeSearchRequest;
import com.freelanceops.backend.domain.knowledge.dto.request.CreateDocumentRequest;
import com.freelanceops.backend.domain.knowledge.dto.request.DocumentChunkRequest;
import com.freelanceops.backend.domain.knowledge.model.KnowledgeSourceType;
import com.freelanceops.backend.domain.knowledge.entity.DocumentChunkEntity;
import com.freelanceops.backend.domain.knowledge.entity.DocumentEntity;
import com.freelanceops.backend.domain.knowledge.repository.DocumentChunkRepository;
import com.freelanceops.backend.domain.knowledge.repository.DocumentRepository;
import com.freelanceops.backend.domain.knowledge.repository.KnowledgeSearchRepository;
import com.freelanceops.backend.domain.workspace.policy.AuthorizationDecision;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import com.freelanceops.backend.domain.workspace.service.WorkspaceAuthorizationService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.web.server.ResponseStatusException;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class KnowledgeServiceTest {
    @Mock private DocumentRepository documentRepository;
    @Mock private DocumentChunkRepository chunkRepository;
    @Mock private KnowledgeSearchRepository searchRepository;
    @Mock private WorkspaceAuthorizationService authorizationService;

    @Test
    void hybridSearchUsesRrfWithoutMixingRawScores() {
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        DocumentChunkEntity keywordOnly = chunk(workspaceId, documentId, "keyword");
        DocumentChunkEntity both = chunk(workspaceId, documentId, "both");
        DocumentEntity document = document(workspaceId, documentId);
        when(authorizationService.authorize(userId, workspaceId, PermissionCode.DOCUMENT_READ)).thenReturn(AuthorizationDecision.ALLOWED);
        when(searchRepository.keywordSearch(workspaceId, "계약", 20)).thenReturn(List.of(keywordOnly, both));
        when(searchRepository.vectorSearch(org.mockito.ArgumentMatchers.eq(workspaceId), any(float[].class), org.mockito.ArgumentMatchers.eq(20))).thenReturn(List.of(both, keywordOnly));
        when(documentRepository.findByIdAndWorkspaceId(documentId, workspaceId)).thenReturn(Optional.of(document));

        var results = service().search(userId, workspaceId, new KnowledgeSearchRequest("계약", floats(), 5));

        assertThat(results).hasSize(2);
        assertThat(results.get(0).rrfScore()).isEqualTo(results.get(1).rrfScore());
        assertThat(results).allSatisfy(result -> assertThat(result.documentId()).isEqualTo(documentId));
    }

    @Test
    void duplicateWorkspaceContentIsReportedAsAConflict() {
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        when(authorizationService.authorize(userId, workspaceId, PermissionCode.DOCUMENT_WRITE))
            .thenReturn(AuthorizationDecision.ALLOWED);
        when(documentRepository.saveAndFlush(any())).thenThrow(
            new DataIntegrityViolationException("constraint uq_document_workspace_hash")
        );
        CreateDocumentRequest request = new CreateDocumentRequest(
            KnowledgeSourceType.POLICY, "정책", null, null, null, null, null,
            List.of(new DocumentChunkRequest("동일한 본문", null, null, null, null))
        );

        assertThatThrownBy(() -> service().create(userId, workspaceId, request))
            .isInstanceOfSatisfying(ResponseStatusException.class, error ->
                assertThat(error.getStatusCode().value()).isEqualTo(409));
    }

    private KnowledgeService service() {
        return new KnowledgeService(documentRepository, chunkRepository, searchRepository, authorizationService);
    }

    private static DocumentChunkEntity chunk(UUID workspaceId, UUID documentId, String content) {
        return new DocumentChunkEntity(UUID.randomUUID(), workspaceId, documentId, 0, content, null, null, null, null, Instant.now());
    }

    private static DocumentEntity document(UUID workspaceId, UUID documentId) {
        return new DocumentEntity(documentId, workspaceId, "POLICY", "정책", "https://example.com", "v1", "KR", null, null, "a".repeat(64), UUID.randomUUID(), Instant.now());
    }

    private static List<Float> floats() {
        return java.util.Collections.nCopies(1536, 0.1F);
    }

}
