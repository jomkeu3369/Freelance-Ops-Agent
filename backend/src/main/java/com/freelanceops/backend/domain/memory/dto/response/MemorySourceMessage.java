package com.freelanceops.backend.domain.memory.dto.response;

import com.freelanceops.backend.domain.memory.entity.SourceMessageEntity;
import java.time.Instant;
import java.util.UUID;

public record MemorySourceMessage(UUID id, long eventOrder, String kind, String content, String prompt, Instant createdAt) {
    public static MemorySourceMessage from(SourceMessageEntity value) { return new MemorySourceMessage(value.id(), value.eventOrder(), value.kind(), value.content(), value.prompt(), value.createdAt()); }
}
