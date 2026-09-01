package com.freelanceops.backend.domain.knowledge.service;

import com.freelanceops.backend.domain.knowledge.entity.*;
import com.freelanceops.backend.domain.knowledge.model.RaptorNodeKind;
import com.freelanceops.backend.domain.knowledge.repository.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.*;

@Service
public class RaptorRetrievalService {
    private final RaptorActiveSnapshotRepository activeSnapshotRepository;
    private final RaptorNodeRepository nodeRepository;
    private final RaptorNodeSearchRepository nodeSearchRepository;
    private final DocumentChunkRepository chunkRepository;

    public RaptorRetrievalService(RaptorActiveSnapshotRepository activeSnapshotRepository, RaptorNodeRepository nodeRepository, RaptorNodeSearchRepository nodeSearchRepository, DocumentChunkRepository chunkRepository) {
        this.activeSnapshotRepository = activeSnapshotRepository; this.nodeRepository = nodeRepository;
        this.nodeSearchRepository = nodeSearchRepository; this.chunkRepository = chunkRepository;
    }

    @Transactional(readOnly = true)
    public List<DocumentChunkEntity> retrieve(UUID workspaceId, float[] queryEmbedding, int treeTopK, int evidenceTopK) {
        if (queryEmbedding == null || queryEmbedding.length != 1536 || treeTopK < 1 || evidenceTopK < 1) throw new IllegalArgumentException("invalid RAPTOR retrieval request");
        RaptorActiveSnapshotEntity active = activeSnapshotRepository.findById(workspaceId).orElse(null);
        if (active == null) return List.of();
        List<RaptorNodeEntity> nodes = nodeRepository.findAllByWorkspaceIdAndSnapshotId(workspaceId, active.snapshotId());
        if (nodes.isEmpty()) throw new IllegalStateException("active RAPTOR snapshot has no nodes");

        Map<UUID, RaptorNodeEntity> nodesById = new HashMap<>(); nodes.forEach(node -> nodesById.put(node.id(), node));
        List<RaptorNodeEntity> selected = nodeSearchRepository.nearest(workspaceId, active.snapshotId(), queryEmbedding, Math.min(treeTopK, nodes.size()));
        Set<UUID> leafNodeIds = new HashSet<>();
        for (RaptorNodeEntity node : selected) collectLeaves(node, nodesById, leafNodeIds, new HashSet<>());
        List<UUID> rankedChunkIds = leafNodeIds.stream().map(nodesById::get)
            .sorted(Comparator.comparingDouble((RaptorNodeEntity node) -> cosine(node.embedding(), queryEmbedding)).reversed())
            .limit(evidenceTopK).map(RaptorNodeEntity::sourceChunkId).toList();
        Map<UUID, DocumentChunkEntity> chunksById = new HashMap<>();
        chunkRepository.findAllById(rankedChunkIds).stream().filter(chunk -> workspaceId.equals(chunk.workspaceId())).forEach(chunk -> chunksById.put(chunk.id(), chunk));
        return rankedChunkIds.stream().map(chunksById::get).filter(Objects::nonNull).toList();
    }

    private static void collectLeaves(RaptorNodeEntity node, Map<UUID, RaptorNodeEntity> nodesById, Set<UUID> output, Set<UUID> path) {
        if (!path.add(node.id())) throw new IllegalStateException("RAPTOR graph contains a cycle");
        if (node.kind() == RaptorNodeKind.LEAF) output.add(node.id());
        else for (UUID childId : node.childIds()) {
            RaptorNodeEntity child = nodesById.get(childId);
            if (child == null) throw new IllegalStateException("RAPTOR graph references a missing child");
            collectLeaves(child, nodesById, output, new HashSet<>(path));
        }
    }

    private static double cosine(float[] left, float[] right) {
        double dot = 0; double leftNorm = 0; double rightNorm = 0;
        for (int index = 0; index < left.length; index++) { dot += left[index] * right[index]; leftNorm += left[index] * left[index]; rightNorm += right[index] * right[index]; }
        if (leftNorm == 0 || rightNorm == 0) throw new IllegalArgumentException("RAPTOR cosine vectors must not be zero");
        return dot / Math.sqrt(leftNorm * rightNorm);
    }
}
