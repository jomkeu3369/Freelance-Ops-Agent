package com.freelanceops.backend.domain.knowledge.service;

import com.freelanceops.backend.domain.agentrun.model.Provider;
import com.freelanceops.backend.domain.knowledge.dto.request.*;
import com.freelanceops.backend.domain.knowledge.dto.response.*;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.UUID;

@Service
public class DocumentReviewService {
    private final DocumentService knowledge;
    private final RaptorIndexService indexes;
    private final String embeddingModel;
    private final String summaryModel;

    public DocumentReviewService(
            DocumentService knowledge,
            RaptorIndexService indexes,
            @Value("${app.knowledge.embedding-model:text-embedding-3-small}") String embeddingModel,
            @Value("${app.knowledge.summary-model:gpt-5.6-luna}") String summaryModel) {
        this.knowledge = knowledge;
        this.indexes = indexes;
        this.embeddingModel = embeddingModel;
        this.summaryModel = summaryModel;
    }

    public DocumentConfirmationResponse confirm(
            UUID userId, UUID workspaceId, UUID documentId, ConfirmDocumentRequest request) {
        DocumentResponse document =
                knowledge.confirm(userId, workspaceId, documentId, request.expectedVersion());
        if (document.projectId() == null)
            return new DocumentConfirmationResponse(document, "KEYWORD_ONLY");
        try {
            String trace =
                    "00-"
                            + UUID.randomUUID().toString().replace("-", "")
                            + "-"
                            + UUID.randomUUID().toString().replace("-", "").substring(0, 16)
                            + "-01";
            indexes.rebuild(
                    userId,
                    workspaceId,
                    document.projectId(),
                    new CreateRaptorIndexRequest(
                            Provider.OPENAI, embeddingModel, summaryModel, 8, 4, 20),
                    trace);
            return new DocumentConfirmationResponse(
                    knowledge.get(userId, workspaceId, documentId), "INDEXED");
        } catch (RuntimeException error) {
            // 문서 확정은 유지된다. 화면에는 인덱싱 재시도가 필요함을 표시한다.
            return new DocumentConfirmationResponse(document, "PENDING");
        }
    }
}
