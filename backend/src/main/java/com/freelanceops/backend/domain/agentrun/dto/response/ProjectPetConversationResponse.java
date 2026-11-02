package com.freelanceops.backend.domain.agentrun.dto.response;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(name = "View")
public record ProjectPetConversationResponse(
        ProjectPetConversationSettingsResponse settings, long version) {}
