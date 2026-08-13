package com.freelanceops.backend.domain.client.dto.response;

import com.freelanceops.backend.domain.client.entity.ClientStatus;

import java.time.Instant;
import java.util.UUID;

public record ClientResponse(
    UUID id,
    UUID workspaceId,
    String name,
    String companyName,
    String email,
    String phone,
    String notes,
    ClientStatus status,
    UUID createdBy,
    Instant createdAt,
    Instant updatedAt,
    long version
) {
}
