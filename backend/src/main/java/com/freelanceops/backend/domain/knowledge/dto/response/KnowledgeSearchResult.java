package com.freelanceops.backend.domain.knowledge.dto.response;
import com.freelanceops.backend.domain.memory.dto.response.MemorySourceMessage;
import com.freelanceops.backend.domain.knowledge.model.KnowledgeSourceType;
import java.time.LocalDate;
import java.util.UUID;
import java.util.List;

public record KnowledgeSearchResult(
    UUID chunkId, UUID documentId, String documentTitle, KnowledgeSourceType sourceType,
    String sourceUri, String sourceVersion, String jurisdiction, LocalDate effectiveFrom,
    LocalDate effectiveUntil, String content, double rrfScore, int keywordRank, Integer vectorRank,
    String origin, String memoryType, String confirmationStatus, UUID projectId, int revisionNumber,
    List<MemorySourceMessage> sourceMessages
) {
}
