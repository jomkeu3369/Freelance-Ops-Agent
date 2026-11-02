package com.freelanceops.backend.domain.agentrun.dto.response;

import io.swagger.v3.oas.annotations.media.Schema;

import java.util.List;
import java.util.UUID;

@Schema(name = "Settings")
public record ProjectPetConversationSettingsResponse(
        boolean petMode,
        boolean debateEnabled,
        List<UUID> participantPetIds,
        AgentRunView.QuotationDraft acceptedDraft,
        UUID draftSourceRunId) {}
