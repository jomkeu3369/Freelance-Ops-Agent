package com.freelanceops.backend.domain.knowledge.service;

import com.freelanceops.backend.domain.knowledge.dto.request.KnowledgeSearchRequest;
import com.freelanceops.backend.domain.knowledge.dto.response.KnowledgeSearchResult;
import com.freelanceops.backend.domain.knowledge.entity.DocumentChunkEntity;
import com.freelanceops.backend.domain.knowledge.entity.DocumentEntity;
import com.freelanceops.backend.domain.knowledge.model.KnowledgeSourceType;
import com.freelanceops.backend.domain.knowledge.repository.DocumentRepository;
import com.freelanceops.backend.domain.knowledge.repository.KnowledgeSearchRepository;
import com.freelanceops.backend.domain.memory.service.ProjectMemoryService;
import com.freelanceops.backend.domain.workspace.policy.AuthorizationDecision;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import com.freelanceops.backend.domain.workspace.service.WorkspaceAuthorizationService;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

@Service
public class KnowledgeSearchService {
    private static final double RRF_K = 60.0;
    private final DocumentRepository documentRepository;
    private final KnowledgeSearchRepository searchRepository;
    private final WorkspaceAuthorizationService authorizationService;
    private final RaptorRetrievalService raptorRetrievalService;
    private final ProjectMemoryService projectMemory;

    public KnowledgeSearchService(
            DocumentRepository documentRepository,
            KnowledgeSearchRepository searchRepository,
            WorkspaceAuthorizationService authorizationService,
            RaptorRetrievalService raptorRetrievalService,
            ProjectMemoryService projectMemory) {
        this.documentRepository = documentRepository;
        this.searchRepository = searchRepository;
        this.authorizationService = authorizationService;
        this.raptorRetrievalService = raptorRetrievalService;
        this.projectMemory = projectMemory;
    }

    @Transactional(readOnly = true)
    public List<KnowledgeSearchResult> search(
            UUID userId, UUID workspaceId, KnowledgeSearchRequest request) {
        return search(userId, workspaceId, request, null, null);
    }

    @Transactional(readOnly = true)
    public List<KnowledgeSearchResult> search(
            UUID userId,
            UUID workspaceId,
            KnowledgeSearchRequest request,
            UUID projectId,
            UUID excludedRunId) {
        authorize(userId, workspaceId, PermissionCode.DOCUMENT_READ);
        if (request.embedding() != null
                && (request.embeddingModel() == null || request.embeddingModel().isBlank()))
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST, "embedding model is required");
        int candidateLimit = Math.min(request.limit() * 4, 200);
        List<DocumentChunkEntity> keyword =
                searchRepository.keywordSearch(
                        workspaceId,
                        projectId,
                        excludedRunId,
                        request.query().trim(),
                        candidateLimit);
        List<DocumentChunkEntity> vector =
                request.embedding() == null
                        ? List.of()
                        : searchRepository.vectorSearch(
                                workspaceId,
                                projectId,
                                excludedRunId,
                                embedding(request.embedding()),
                                request.embeddingModel(),
                                candidateLimit);
        List<DocumentChunkEntity> raptor =
                request.embedding() == null
                        ? List.of()
                        : raptorRetrievalService.retrieve(
                                workspaceId,
                                projectId,
                                excludedRunId,
                                embedding(request.embedding()),
                                request.embeddingModel(),
                                candidateLimit,
                                candidateLimit);
        Map<UUID, RankedChunk> ranked = new HashMap<>();
        addRanks(ranked, keyword, RankSource.KEYWORD);
        addRanks(ranked, vector, RankSource.VECTOR);
        addRanks(ranked, raptor, RankSource.RAPTOR);
        var candidates =
                ranked.values().stream()
                        .sorted(Comparator.comparingDouble(RankedChunk::score).reversed())
                        .map(this::searchResult)
                        .sorted(Comparator.comparingInt(KnowledgeSearchService::authority))
                        .toList();
        List<KnowledgeSearchResult> selected = new ArrayList<>();
        Map<UUID, Integer> perDocument = new HashMap<>();
        for (var candidate : candidates) {
            if (perDocument.getOrDefault(candidate.documentId(), 0) >= 2
                    || selected.stream()
                            .anyMatch(
                                    existing ->
                                            nearDuplicate(existing.content(), candidate.content())))
                continue;
            if ("agent".equals(candidate.origin()) && candidate.sourceMessages().isEmpty())
                continue;
            selected.add(candidate);
            perDocument.merge(candidate.documentId(), 1, Integer::sum);
            if (selected.size() == request.limit()) break;
        }
        return List.copyOf(selected);
    }

    private static int authority(KnowledgeSearchResult value) {
        return "user".equals(value.origin()) ? 0 : "agent".equals(value.origin()) ? 2 : 1;
    }

    private static boolean nearDuplicate(String left, String right) {
        String normalizedLeft =
                left.toLowerCase(Locale.ROOT).replaceAll("[^\\p{L}\\p{N}]+", " ").trim();
        String normalizedRight =
                right.toLowerCase(Locale.ROOT).replaceAll("[^\\p{L}\\p{N}]+", " ").trim();
        if (normalizedLeft.equals(normalizedRight)) return true;
        var leftWords = new HashSet<>(List.of(normalizedLeft.split("\\s+")));
        var rightWords = new HashSet<>(List.of(normalizedRight.split("\\s+")));
        if (Math.min(leftWords.size(), rightWords.size()) < 8) return false;
        var intersection = new HashSet<>(leftWords);
        intersection.retainAll(rightWords);
        var union = new HashSet<>(leftWords);
        union.addAll(rightWords);
        return (double) intersection.size() / union.size() >= 0.9;
    }

    private KnowledgeSearchResult searchResult(RankedChunk ranked) {
        DocumentChunkEntity chunk = ranked.chunk();
        DocumentEntity document =
                documentRepository
                        .findByIdAndWorkspaceId(chunk.documentId(), chunk.workspaceId())
                        .filter(candidate -> candidate.eligible(LocalDate.now()))
                        .orElseThrow(
                                () ->
                                        new IllegalStateException(
                                                "search result references unavailable document"));
        return new KnowledgeSearchResult(
                chunk.id(),
                document.id(),
                document.title(),
                KnowledgeSourceType.valueOf(document.sourceType()),
                document.sourceUri(),
                document.sourceVersion(),
                document.jurisdiction(),
                document.effectiveFrom(),
                document.effectiveUntil(),
                chunk.content(),
                ranked.score(),
                ranked.keywordRank(),
                ranked.vectorRank(),
                document.origin(),
                document.memoryType(),
                document.confirmationStatus(),
                document.projectId(),
                document.revisionNumber(),
                projectMemory.resolve(
                        document.workspaceId(),
                        document.projectId(),
                        List.of(document.sourceMessageIds())));
    }

    private static void addRanks(
            Map<UUID, RankedChunk> ranked, List<DocumentChunkEntity> chunks, RankSource source) {
        for (int index = 0; index < chunks.size(); index++) {
            int rank = index + 1;
            DocumentChunkEntity chunk = chunks.get(index);
            RankedChunk current =
                    ranked.getOrDefault(chunk.id(), new RankedChunk(chunk, 0, 0, null, null));
            double score = current.score() + 1.0 / (RRF_K + rank);
            ranked.put(
                    chunk.id(),
                    switch (source) {
                        case KEYWORD ->
                                new RankedChunk(
                                        chunk,
                                        score,
                                        rank,
                                        current.vectorRank(),
                                        current.raptorRank());
                        case VECTOR ->
                                new RankedChunk(
                                        chunk,
                                        score,
                                        current.keywordRank(),
                                        rank,
                                        current.raptorRank());
                        case RAPTOR ->
                                new RankedChunk(
                                        chunk,
                                        score,
                                        current.keywordRank(),
                                        current.vectorRank(),
                                        rank);
                    });
        }
    }

    private void authorize(UUID userId, UUID workspaceId, PermissionCode permission) {
        AuthorizationDecision decision =
                authorizationService.authorize(userId, workspaceId, permission);
        if (decision == AuthorizationDecision.NOT_FOUND)
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        if (decision == AuthorizationDecision.FORBIDDEN)
            throw new ResponseStatusException(HttpStatus.FORBIDDEN);
    }

    private static float[] embedding(List<Float> values) {
        if (values == null) return null;
        float[] result = new float[values.size()];
        for (int index = 0; index < values.size(); index++) result[index] = values.get(index);
        return result;
    }

    private enum RankSource {
        KEYWORD,
        VECTOR,
        RAPTOR
    }

    private record RankedChunk(
            DocumentChunkEntity chunk,
            double score,
            int keywordRank,
            Integer vectorRank,
            Integer raptorRank) {}
}
