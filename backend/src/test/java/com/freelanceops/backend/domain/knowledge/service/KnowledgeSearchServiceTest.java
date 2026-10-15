package com.freelanceops.backend.domain.knowledge.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.freelanceops.backend.domain.knowledge.dto.request.KnowledgeSearchRequest;
import com.freelanceops.backend.domain.knowledge.entity.DocumentChunkEntity;
import com.freelanceops.backend.domain.knowledge.entity.DocumentEntity;
import com.freelanceops.backend.domain.knowledge.repository.DocumentRepository;
import com.freelanceops.backend.domain.knowledge.repository.KnowledgeSearchRepository;
import com.freelanceops.backend.domain.memory.service.ProjectMemoryService;
import com.freelanceops.backend.domain.workspace.policy.AuthorizationDecision;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import com.freelanceops.backend.domain.workspace.service.WorkspaceAuthorizationService;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@ExtendWith(MockitoExtension.class)
class KnowledgeSearchServiceTest {
    @Mock private DocumentRepository documentRepository;
    @Mock private KnowledgeSearchRepository searchRepository;
    @Mock private RaptorRetrievalService raptorRetrievalService;
    @Mock private WorkspaceAuthorizationService authorizationService;

    private KnowledgeSearchService service() {
        return new KnowledgeSearchService(
                documentRepository,
                searchRepository,
                authorizationService,
                raptorRetrievalService,
                org.mockito.Mockito.mock(ProjectMemoryService.class));
    }

    @Test
    void hybridSearchUsesRrfWithoutMixingRawScores() {
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        DocumentChunkEntity keywordOnly = chunk(workspaceId, documentId, "keyword");
        DocumentChunkEntity both = chunk(workspaceId, documentId, "both");
        DocumentEntity document = document(workspaceId, documentId);
        document.confirm(userId, Instant.now(), null);
        when(authorizationService.authorize(userId, workspaceId, PermissionCode.DOCUMENT_READ))
                .thenReturn(AuthorizationDecision.ALLOWED);
        when(searchRepository.keywordSearch(workspaceId, null, null, "계약", 20))
                .thenReturn(List.of(keywordOnly, both));
        when(searchRepository.vectorSearch(
                        org.mockito.ArgumentMatchers.eq(workspaceId),
                        org.mockito.ArgumentMatchers.isNull(),
                        org.mockito.ArgumentMatchers.isNull(),
                        any(float[].class),
                        org.mockito.ArgumentMatchers.eq("embedding"),
                        org.mockito.ArgumentMatchers.eq(20)))
                .thenReturn(List.of(both, keywordOnly));
        when(documentRepository.findByIdAndWorkspaceId(documentId, workspaceId))
                .thenReturn(Optional.of(document));

        var results =
                service()
                        .search(
                                userId,
                                workspaceId,
                                new KnowledgeSearchRequest("계약", floats(), 5, "embedding"));

        assertThat(results).hasSize(2);
        assertThat(results.get(0).rrfScore()).isEqualTo(results.get(1).rrfScore());
        assertThat(results)
                .allSatisfy(result -> assertThat(result.documentId()).isEqualTo(documentId));
    }

    @Test
    void limitsResultsFromOneDocument() {
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        DocumentEntity document = document(workspaceId, documentId);
        document.confirm(userId, Instant.now(), null);
        when(authorizationService.authorize(userId, workspaceId, PermissionCode.DOCUMENT_READ))
                .thenReturn(AuthorizationDecision.ALLOWED);
        when(searchRepository.keywordSearch(workspaceId, null, null, "계약", 20))
                .thenReturn(
                        List.of(
                                chunk(workspaceId, documentId, "계약서 초안"),
                                chunk(workspaceId, documentId, "납기 일정"),
                                chunk(workspaceId, documentId, "유지보수 범위")));
        when(documentRepository.findByIdAndWorkspaceId(documentId, workspaceId))
                .thenReturn(Optional.of(document));

        var results =
                service()
                        .search(
                                userId,
                                workspaceId,
                                new KnowledgeSearchRequest("계약", null, 5, null));

        assertThat(results)
                .extracting(result -> result.content())
                .containsExactly("계약서 초안", "납기 일정");
    }

    @Test
    void removesDuplicateTextDespitePunctuationDifferences() {
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        UUID documentId = UUID.randomUUID();
        DocumentEntity document = document(workspaceId, documentId);
        document.confirm(userId, Instant.now(), null);
        when(authorizationService.authorize(userId, workspaceId, PermissionCode.DOCUMENT_READ))
                .thenReturn(AuthorizationDecision.ALLOWED);
        when(searchRepository.keywordSearch(workspaceId, null, null, "계약", 20))
                .thenReturn(
                        List.of(
                                chunk(workspaceId, documentId, "계약서, 납기 일정"),
                                chunk(workspaceId, documentId, "계약서 납기 일정.")));
        when(documentRepository.findByIdAndWorkspaceId(documentId, workspaceId))
                .thenReturn(Optional.of(document));

        var results =
                service()
                        .search(
                                userId,
                                workspaceId,
                                new KnowledgeSearchRequest("계약", null, 5, null));

        assertThat(results).hasSize(1);
        assertThat(results.getFirst().content()).isEqualTo("계약서, 납기 일정");
    }

    @Test
    void hidesWorkspaceWithoutMembershipBeforeSearching() {
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        when(authorizationService.authorize(userId, workspaceId, PermissionCode.DOCUMENT_READ))
                .thenReturn(AuthorizationDecision.NOT_FOUND);

        assertThatThrownBy(
                        () ->
                                service()
                                        .search(
                                                userId,
                                                workspaceId,
                                                new KnowledgeSearchRequest("계약", null, 5, null)))
                .isInstanceOfSatisfying(
                        ResponseStatusException.class,
                        error -> assertThat(error.getStatusCode().value()).isEqualTo(404));
        verifyNoInteractions(searchRepository, documentRepository, raptorRetrievalService);
    }

    private static DocumentChunkEntity chunk(UUID workspaceId, UUID documentId, String content) {
        return new DocumentChunkEntity(
                UUID.randomUUID(),
                workspaceId,
                documentId,
                0,
                content,
                null,
                null,
                null,
                null,
                Instant.now());
    }

    private static DocumentEntity document(UUID workspaceId, UUID documentId) {
        return new DocumentEntity(
                documentId,
                workspaceId,
                "POLICY",
                "정책",
                "https://example.com",
                "v1",
                "KR",
                null,
                null,
                "a".repeat(64),
                UUID.randomUUID(),
                Instant.now());
    }

    private static List<Float> floats() {
        return java.util.Collections.nCopies(1536, 0.1F);
    }
}
