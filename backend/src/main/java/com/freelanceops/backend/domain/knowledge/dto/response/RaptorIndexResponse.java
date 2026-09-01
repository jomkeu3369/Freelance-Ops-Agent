package com.freelanceops.backend.domain.knowledge.dto.response;

import java.util.UUID;

public record RaptorIndexResponse(UUID snapshotId, String status, int nodeCount) {
}
