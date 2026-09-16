package com.freelanceops.backend.domain.knowledge.service;

import com.freelanceops.backend.domain.knowledge.dto.request.ConfirmDocumentRequest;
import com.freelanceops.backend.domain.knowledge.dto.response.DocumentResponse;
import org.junit.jupiter.api.Test;
import java.util.UUID;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class DocumentReviewServiceTest {
    private final KnowledgeService knowledge = mock(KnowledgeService.class);
    private final RaptorIndexService indexes = mock(RaptorIndexService.class);
    private final DocumentReviewService reviews = new DocumentReviewService(knowledge, indexes, "embedding", "summary");
    private final UUID user = UUID.randomUUID(), workspace = UUID.randomUUID(), document = UUID.randomUUID();

    @Test
    void failedConfirmationNeverStartsIndexing() {
        when(knowledge.confirm(user, workspace, document, 3)).thenThrow(new IllegalStateException("stale"));
        assertThatThrownBy(() -> reviews.confirm(user, workspace, document, new ConfirmDocumentRequest(3L))).hasMessage("stale");
        verifyNoInteractions(indexes);
    }

    @Test
    void confirmedProjectDocumentIsIndexedAndFailureIsVisible() {
        DocumentResponse confirmed = mock(DocumentResponse.class);
        UUID project = UUID.randomUUID();
        when(confirmed.projectId()).thenReturn(project);
        when(knowledge.confirm(user, workspace, document, 3)).thenReturn(confirmed);
        when(indexes.rebuild(eq(user), eq(workspace), eq(project), any(), anyString())).thenThrow(new IllegalStateException("offline"));
        assertThat(reviews.confirm(user, workspace, document, new ConfirmDocumentRequest(3L)).indexStatus()).isEqualTo("PENDING");
        verify(knowledge).confirm(user, workspace, document, 3);
        verify(indexes).rebuild(eq(user), eq(workspace), eq(project), any(), anyString());
    }

    @Test
    void confirmedProjectDocumentReturnsPublishedStatus() {
        DocumentResponse confirmed = mock(DocumentResponse.class);
        UUID project = UUID.randomUUID();
        when(confirmed.projectId()).thenReturn(project);
        when(knowledge.confirm(user, workspace, document, 3)).thenReturn(confirmed);
        when(knowledge.get(user, workspace, document)).thenReturn(confirmed);
        assertThat(reviews.confirm(user, workspace, document, new ConfirmDocumentRequest(3L)).indexStatus()).isEqualTo("INDEXED");
        verify(indexes).rebuild(eq(user), eq(workspace), eq(project), any(), anyString());
    }

    @Test
    void workspaceReferencesAreConfirmedWithoutStartingAProjectRun() {
        when(knowledge.confirm(user, workspace, document, 3)).thenReturn(mock(DocumentResponse.class));
        assertThat(reviews.confirm(user, workspace, document, new ConfirmDocumentRequest(3L)).indexStatus()).isEqualTo("KEYWORD_ONLY");
        verifyNoInteractions(indexes);
    }
}
