package com.freelanceops.backend.domain.agentrun.dto;

import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView;
import jakarta.validation.constraints.*;
import java.util.List;
import java.util.UUID;

/** Server-resolved, immutable conversation context for one admitted run. */
public record PetConversation(
        boolean petMode,
        boolean debateEnabled,
        UUID recipientPetId,
        List<Turn> history,
        AgentRunView.QuotationDraft acceptedDraft,
        List<java.util.Map<String, Object>> rateCards) {
    public PetConversation {
        history = List.copyOf(history);
        rateCards = rateCards.stream().map(java.util.Map::copyOf).toList();
    }
    public record Command(@Min(0) long settingsVersion, UUID recipientPetId) {}
    public record Turn(String userText, List<AgentRunView.PetMessage> messages) {
        public Turn { messages = List.copyOf(messages); }
    }
}
