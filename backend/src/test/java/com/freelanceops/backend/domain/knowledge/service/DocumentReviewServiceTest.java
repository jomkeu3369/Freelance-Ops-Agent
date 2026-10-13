package com.freelanceops.backend.domain.knowledge.service;

import com.freelanceops.backend.domain.knowledge.dto.request.ConfirmDocumentRequest;
import com.freelanceops.backend.domain.knowledge.dto.response.DocumentResponse;
import org.junit.jupiter.api.Test;
import java.util.UUID;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class DocumentReviewServiceTest {
    private final KnowledgeService knowledge = mock(KnowledgeService.class);
    private final DocumentReviewService reviews = new DocumentReviewService(knowledge);
    private final UUID user = UUID.randomUUID(), workspace = UUID.randomUUID(), document = UUID.randomUUID();

    @Test
    void failedConfirmationIsNotReportedAsSaved() {
        when(knowledge.confirm(user, workspace, document, 3)).thenThrow(new IllegalStateException("stale"));
        assertThatThrownBy(() -> reviews.confirm(user, workspace, document, new ConfirmDocumentRequest(3L))).hasMessage("stale");
        verify(knowledge).confirm(user, workspace, document, 3);
        verifyNoMoreInteractions(knowledge);
    }

    @Test
    void projectConfirmationIsKeywordOnlyWithoutAnyImplicitPaidIndexing() {
        DocumentResponse confirmed = mock(DocumentResponse.class);
        when(confirmed.projectId()).thenReturn(UUID.randomUUID());
        when(knowledge.confirm(user, workspace, document, 3)).thenReturn(confirmed);
        var result = reviews.confirm(user, workspace, document, new ConfirmDocumentRequest(3L));
        assertThat(result.indexStatus()).isEqualTo("KEYWORD_ONLY");
        assertThat(result.document()).isSameAs(confirmed);
        verify(knowledge).confirm(user, workspace, document, 3);
        verifyNoMoreInteractions(knowledge);
    }

    @Test
    void workspaceReferencesAreAlsoKeywordOnly() {
        when(knowledge.confirm(user, workspace, document, 3)).thenReturn(mock(DocumentResponse.class));
        assertThat(reviews.confirm(user, workspace, document, new ConfirmDocumentRequest(3L)).indexStatus()).isEqualTo("KEYWORD_ONLY");
        verify(knowledge).confirm(user, workspace, document, 3);
        verifyNoMoreInteractions(knowledge);
    }
}
