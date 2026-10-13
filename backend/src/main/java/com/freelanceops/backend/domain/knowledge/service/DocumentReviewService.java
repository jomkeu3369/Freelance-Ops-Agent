package com.freelanceops.backend.domain.knowledge.service;

import com.freelanceops.backend.domain.knowledge.dto.request.ConfirmDocumentRequest;
import com.freelanceops.backend.domain.knowledge.dto.response.DocumentConfirmationResponse;
import org.springframework.stereotype.Service;
import java.util.UUID;

/** Review confirmation is cost-free. Paid indexing requires a separate explicit action. */
@Service
public class DocumentReviewService {
    private final KnowledgeService knowledge;
    public DocumentReviewService(KnowledgeService knowledge) { this.knowledge = knowledge; }

    public DocumentConfirmationResponse confirm(UUID userId, UUID workspaceId, UUID documentId, ConfirmDocumentRequest request) {
        var document = knowledge.confirm(userId, workspaceId, documentId, request.expectedVersion());
        return new DocumentConfirmationResponse(document, "KEYWORD_ONLY");
    }
}
