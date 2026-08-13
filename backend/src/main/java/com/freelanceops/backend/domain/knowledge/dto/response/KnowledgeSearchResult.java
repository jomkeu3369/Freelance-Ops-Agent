package com.freelanceops.backend.domain.knowledge.dto.response;

import com.freelanceops.backend.domain.knowledge.model.KnowledgeSourceType;
import java.time.LocalDate;
import java.util.UUID;

public record KnowledgeSearchResult(
    UUID chunkId, UUID documentId, String documentTitle, KnowledgeSourceType sourceType,
    String sourceUri, String sourceVersion, String jurisdiction, LocalDate effectiveFrom,
    LocalDate effectiveUntil, String content, double rrfScore, int keywordRank, Integer vectorRank
) {
}
