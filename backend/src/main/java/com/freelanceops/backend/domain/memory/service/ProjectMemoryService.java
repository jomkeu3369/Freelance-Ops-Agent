package com.freelanceops.backend.domain.memory.service;

import com.freelanceops.backend.domain.memory.entity.SourceMessageEntity;
import com.freelanceops.backend.domain.memory.dto.response.MemorySourceMessage;
import com.freelanceops.backend.domain.memory.repository.SourceMessageRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.Instant;
import java.util.*;

@Service
public class ProjectMemoryService {
    private final SourceMessageRepository repository;
    public ProjectMemoryService(SourceMessageRepository repository) { this.repository = repository; }

    @Transactional(readOnly = true)
    public List<MemorySourceMessage> current(UUID workspaceId, UUID projectId) {
        return roots(repository.findAllByWorkspaceIdAndProjectIdOrderByEventOrderAsc(workspaceId, projectId)).stream().map(MemorySourceMessage::from).toList();
    }

    @Transactional(readOnly = true)
    public List<MemorySourceMessage> forRun(UUID workspaceId, UUID projectId, UUID runId) {
        List<SourceMessageEntity> all = repository.findAllByWorkspaceIdAndProjectIdOrderByEventOrderAsc(workspaceId, projectId);
        SourceMessageEntity input = all.stream().filter(value -> "RUN_INPUT".equals(value.kind()) && runId.equals(value.runId())).findFirst().orElse(null);
        if (input == null) return List.of();
        List<SourceMessageEntity> snapshot = new ArrayList<>(roots(all.stream().filter(value -> value.eventOrder() < input.eventOrder()).toList()));
        snapshot.add(input);
        all.stream().filter(value -> "USER_CLARIFICATION".equals(value.kind()) && runId.equals(value.runId()) && value.eventOrder() > input.eventOrder()).forEach(snapshot::add);
        return snapshot.stream().map(MemorySourceMessage::from).toList();
    }

    @Transactional(readOnly = true)
    public List<MemorySourceMessage> resolve(UUID workspaceId, UUID projectId, List<UUID> ids) {
        if (projectId == null || ids.isEmpty()) return List.of();
        return repository.findAllByWorkspaceIdAndProjectIdAndIdInOrderByEventOrderAsc(workspaceId, projectId, ids).stream().map(MemorySourceMessage::from).toList();
    }

    @Transactional
    public void confirmRequirement(UUID workspaceId, UUID projectId, UUID versionId, String content, UUID actor) {
        repository.saveAndFlush(new SourceMessageEntity(workspaceId, projectId, "requirement:" + versionId, "REQUIREMENT_CONFIRMATION", content, actor));
    }

    private static List<SourceMessageEntity> roots(List<SourceMessageEntity> all) {
        long baseline = all.stream().filter(value -> "PROJECT_INPUT".equals(value.kind())).mapToLong(SourceMessageEntity::eventOrder).max().orElse(0);
        long confirmed = all.stream().filter(value -> "REQUIREMENT_CONFIRMATION".equals(value.kind()) && value.eventOrder() >= baseline).mapToLong(SourceMessageEntity::eventOrder).max().orElse(-1);
        return all.stream().filter(value -> value.eventOrder() >= baseline && ("PROJECT_INPUT".equals(value.kind()) || "USER_CLARIFICATION".equals(value.kind()) || value.eventOrder() == confirmed)).toList();
    }

}
