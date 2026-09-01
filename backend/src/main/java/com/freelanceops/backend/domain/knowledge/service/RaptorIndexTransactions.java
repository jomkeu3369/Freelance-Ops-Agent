package com.freelanceops.backend.domain.knowledge.service;

import com.freelanceops.backend.domain.knowledge.client.dto.response.RaptorBuildResponse;
import com.freelanceops.backend.domain.knowledge.entity.*;
import com.freelanceops.backend.domain.knowledge.model.*;
import com.freelanceops.backend.domain.knowledge.repository.*;
import com.freelanceops.backend.domain.workspace.repository.WorkspaceRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.*;

@Service
public class RaptorIndexTransactions {
    private static final int EMBEDDING_DIMENSION = 1536;
    private static final int MAX_SOURCE_CHUNKS = 500;
    private final WorkspaceRepository workspaceRepository;
    private final DocumentChunkRepository chunkRepository;
    private final RaptorIndexSnapshotRepository snapshotRepository;
    private final RaptorNodeRepository nodeRepository;
    private final RaptorActiveSnapshotRepository activeSnapshotRepository;

    public RaptorIndexTransactions(WorkspaceRepository workspaceRepository, DocumentChunkRepository chunkRepository, RaptorIndexSnapshotRepository snapshotRepository, RaptorNodeRepository nodeRepository, RaptorActiveSnapshotRepository activeSnapshotRepository) {
        this.workspaceRepository = workspaceRepository; this.chunkRepository = chunkRepository; this.snapshotRepository = snapshotRepository;
        this.nodeRepository = nodeRepository; this.activeSnapshotRepository = activeSnapshotRepository;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public PreparedBuild begin(UUID snapshotId, UUID workspaceId, UUID createdBy, String embeddingModel, String summaryModel) {
        List<DocumentChunkEntity> chunks = chunkRepository.findAllActiveByWorkspaceId(workspaceId);
        if (chunks.isEmpty()) throw new IllegalStateException("RAPTOR build requires active document chunks");
        if (chunks.size() > MAX_SOURCE_CHUNKS) throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY, "RAPTOR build supports at most 500 active document chunks");
        String fingerprint = fingerprint(chunks);
        snapshotRepository.save(new RaptorIndexSnapshotEntity(snapshotId, workspaceId, embeddingModel, summaryModel, fingerprint, createdBy, Instant.now()));
        return new PreparedBuild(snapshotId, workspaceId, fingerprint, chunks.stream().map(SourceChunk::from).toList());
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public int publish(PreparedBuild prepared, RaptorBuildResponse response) {
        workspaceRepository.findByIdForUpdate(prepared.workspaceId()).orElseThrow(() -> new IllegalStateException("RAPTOR workspace is unavailable"));
        RaptorIndexSnapshotEntity snapshot = snapshotRepository.findForUpdate(prepared.workspaceId(), prepared.snapshotId())
            .orElseThrow(() -> new IllegalStateException("RAPTOR snapshot is unavailable"));
        List<DocumentChunkEntity> currentChunks = chunkRepository.findAllActiveByWorkspaceId(prepared.workspaceId());
        if (!snapshot.sourceFingerprint().equals(fingerprint(currentChunks))) throw new StaleRaptorSourceException();

        ValidatedBuild validated = validate(snapshot, currentChunks, response);
        RaptorActiveSnapshotEntity active = activeSnapshotRepository.findById(prepared.workspaceId()).orElse(null);
        if (active != null) {
            RaptorIndexSnapshotEntity previous = snapshotRepository.findForUpdate(prepared.workspaceId(), active.snapshotId())
                .orElseThrow(() -> new IllegalStateException("active RAPTOR snapshot is unavailable"));
            if (previous.createdAt().isAfter(snapshot.createdAt())) throw new StaleRaptorSourceException();
            previous.supersede();
        }

        Instant now = Instant.now();
        nodeRepository.saveAll(validated.nodes());
        nodeRepository.flush();
        snapshot.publish(now);
        if (active == null) activeSnapshotRepository.save(new RaptorActiveSnapshotEntity(prepared.workspaceId(), prepared.snapshotId(), now));
        else active.replace(prepared.snapshotId(), now);
        activeSnapshotRepository.flush();
        return validated.nodes().size();
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void fail(UUID workspaceId, UUID snapshotId, String failureCode) {
        RaptorIndexSnapshotEntity snapshot = snapshotRepository.findForUpdate(workspaceId, snapshotId).orElse(null);
        if (snapshot != null && snapshot.status() == RaptorSnapshotStatus.BUILDING) snapshot.fail(normalizeFailureCode(failureCode), Instant.now());
    }

    @Transactional
    public void invalidateActiveSnapshot(UUID workspaceId) {
        workspaceRepository.findByIdForUpdate(workspaceId).orElseThrow(() -> new IllegalStateException("RAPTOR workspace is unavailable"));
        RaptorActiveSnapshotEntity active = activeSnapshotRepository.findById(workspaceId).orElse(null);
        if (active == null) return;
        RaptorIndexSnapshotEntity snapshot = snapshotRepository.findForUpdate(workspaceId, active.snapshotId())
            .orElseThrow(() -> new IllegalStateException("active RAPTOR snapshot is unavailable"));
        snapshot.supersede();
        activeSnapshotRepository.delete(active);
        activeSnapshotRepository.flush();
    }

    private static ValidatedBuild validate(RaptorIndexSnapshotEntity snapshot, List<DocumentChunkEntity> chunks, RaptorBuildResponse response) {
        if (response == null || !snapshot.workspaceId().equals(response.workspaceId()) || !snapshot.id().equals(response.snapshotId())) throw new IllegalStateException("RAPTOR response scope does not match the snapshot");
        if (!snapshot.embeddingModel().equals(response.embeddingModel()) || !snapshot.summaryModel().equals(response.summaryModel())) throw new IllegalStateException("RAPTOR response models do not match the snapshot");
        if (response.nodes() == null || response.nodes().isEmpty() || response.nodes().size() > 10000) throw new IllegalStateException("RAPTOR response node count is invalid");

        Map<UUID, DocumentChunkEntity> chunksById = new HashMap<>();
        chunks.forEach(chunk -> chunksById.put(chunk.id(), chunk));
        Map<UUID, RaptorBuildResponse.RaptorNode> nodesById = new HashMap<>();
        for (RaptorBuildResponse.RaptorNode node : response.nodes()) {
            if (node == null || node.nodeId() == null || nodesById.put(node.nodeId(), node) != null) throw new IllegalStateException("RAPTOR node ids must be unique");
        }
        Set<UUID> referenced = new HashSet<>();
        Set<UUID> leafChunks = new HashSet<>();
        List<RaptorNodeEntity> entities = new ArrayList<>();
        Instant now = Instant.now();
        for (RaptorBuildResponse.RaptorNode node : response.nodes()) {
            RaptorNodeKind kind = parseKind(node.kind());
            validateEmbedding(node.embedding());
            List<UUID> childIds = node.childIds() == null ? List.of() : node.childIds();
            if (kind == RaptorNodeKind.LEAF) {
                DocumentChunkEntity chunk = chunksById.get(node.sourceChunkId());
                if (node.level() != 0 || chunk == null || !chunk.documentId().equals(node.documentId()) || !childIds.isEmpty()) throw new IllegalStateException("RAPTOR leaf provenance is invalid");
                leafChunks.add(node.sourceChunkId());
            } else {
                if (node.level() < 1 || node.sourceChunkId() != null || node.documentId() != null || childIds.isEmpty()) throw new IllegalStateException("RAPTOR summary shape is invalid");
                for (UUID childId : childIds) {
                    RaptorBuildResponse.RaptorNode child = nodesById.get(childId);
                    if (child == null || child.level() >= node.level()) throw new IllegalStateException("RAPTOR child hierarchy is invalid");
                    referenced.add(childId);
                }
            }
            if (node.text() == null || node.text().isBlank() || node.text().length() > 20000) throw new IllegalStateException("RAPTOR node content is invalid");
            entities.add(new RaptorNodeEntity(node.nodeId(), snapshot.workspaceId(), snapshot.id(), kind, node.level(), node.text(), floats(node.embedding()), childIds.toArray(UUID[]::new), node.sourceChunkId(), node.documentId(), node.metadata() == null ? Map.of() : node.metadata(), now));
        }
        if (!leafChunks.equals(chunksById.keySet())) throw new IllegalStateException("RAPTOR leaves do not cover the source snapshot");
        Set<UUID> expectedRoots = new HashSet<>(nodesById.keySet()); expectedRoots.removeAll(referenced);
        if (response.rootIds() == null || !expectedRoots.equals(new HashSet<>(response.rootIds()))) throw new IllegalStateException("RAPTOR roots do not match the node graph");
        return new ValidatedBuild(List.copyOf(entities));
    }

    static String fingerprint(List<DocumentChunkEntity> chunks) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            chunks.stream().sorted(Comparator.comparing(DocumentChunkEntity::id)).forEach(chunk -> {
                digest.update(chunk.id().toString().getBytes(StandardCharsets.UTF_8));
                digest.update(chunk.documentId().toString().getBytes(StandardCharsets.UTF_8));
                digest.update(chunk.content().getBytes(StandardCharsets.UTF_8));
            });
            return HexFormat.of().formatHex(digest.digest());
        } catch (NoSuchAlgorithmException error) {
            throw new IllegalStateException("SHA-256 is unavailable", error);
        }
    }

    private static void validateEmbedding(List<Float> embedding) {
        if (embedding == null || embedding.size() != EMBEDDING_DIMENSION) throw new IllegalStateException("RAPTOR embedding dimension must be 1536");
        boolean nonZero = false;
        for (Float value : embedding) {
            if (value == null || !Float.isFinite(value)) throw new IllegalStateException("RAPTOR embedding must contain finite values");
            nonZero |= value != 0;
        }
        if (!nonZero) throw new IllegalStateException("RAPTOR embedding must not be a zero vector");
    }

    private static float[] floats(List<Float> values) { float[] result = new float[values.size()]; for (int index = 0; index < values.size(); index++) result[index] = values.get(index); return result; }
    private static RaptorNodeKind parseKind(String value) { try { return RaptorNodeKind.valueOf(value); } catch (RuntimeException error) { throw new IllegalStateException("RAPTOR node kind is invalid", error); } }
    private static String normalizeFailureCode(String code) { String value = code == null ? "RAPTOR_BUILD_FAILED" : code.replaceAll("[^A-Z0-9_]", "_").toUpperCase(Locale.ROOT); return value.substring(0, Math.min(value.length(), 80)); }

    public record PreparedBuild(UUID snapshotId, UUID workspaceId, String sourceFingerprint, List<SourceChunk> chunks) {
    }
    public record SourceChunk(UUID chunkId, UUID documentId, String text, Map<String, String> metadata) {
        static SourceChunk from(DocumentChunkEntity chunk) { return new SourceChunk(chunk.id(), chunk.documentId(), chunk.content(), Map.of("chunkIndex", Integer.toString(chunk.chunkIndex()))); }
    }
    private record ValidatedBuild(List<RaptorNodeEntity> nodes) {
    }
    public static class StaleRaptorSourceException extends IllegalStateException {
        public StaleRaptorSourceException() { super("RAPTOR source changed before publication"); }
    }
}
