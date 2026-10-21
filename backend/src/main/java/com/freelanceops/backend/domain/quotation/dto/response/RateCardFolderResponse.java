package com.freelanceops.backend.domain.quotation.dto.response;

import java.util.UUID;

public record RateCardFolderResponse(
        UUID id, UUID workspaceId, UUID parentId, String name, long version) {}
