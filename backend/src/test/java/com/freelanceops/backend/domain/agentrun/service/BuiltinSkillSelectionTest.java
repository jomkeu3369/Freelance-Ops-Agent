package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.dto.SkillSelection;
import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest;
import java.util.List;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;
import static org.junit.jupiter.api.Assertions.*;

class BuiltinSkillSelectionTest {
    @Test void defaultAndManualEmptyRemainDifferent() {
        var auto = new SkillSelection(null, null, null, null);
        assertTrue(auto.isDefault());
        var manual = new SkillSelection("MANUAL", List.of(), List.of(), "1.0.0");
        assertFalse(manual.isDefault());
        var request = new StartAgentRunRequest("text", "ko", null, null, null, null, null, List.of(), auto);
        assertNull(request.skillSelection());
        assertFalse(new ObjectMapper().writeValueAsString(request).contains("skillSelection"));
    }
    @Test void unrecognizedIdsVersionsAndDuplicateChoicesAreRejected() {
        assertThrows(IllegalArgumentException.class, () -> new SkillSelection("MANUAL", List.of("../../admin"), List.of(), "1.0.0"));
        assertThrows(IllegalArgumentException.class, () -> new SkillSelection("MANUAL", List.of("writing-proposal", "writing-proposal"), List.of(), "1.0.0"));
        assertThrows(IllegalArgumentException.class, () -> new SkillSelection("AUTO", List.of(), List.of(), "latest"));
        assertThrows(IllegalArgumentException.class, () -> new SkillSelection("MANUAL", List.of("writing-proposal", "writing-case-study", "writing-article-draft", "writing-email-sequence"), List.of(), "1.0.0"));
    }
    @Test void helperPropertyNeverLeaksIntoDurableCommandAndStrictJsonRoundTrips() {
        var mapper = new ObjectMapper();
        for (var selection : List.of(new SkillSelection(null, null, null, null),
                new SkillSelection("MANUAL", List.of("writing-proposal"), List.of(), "1.0.0"),
                new SkillSelection("MANUAL", List.of(), List.of(), "1.0.0"))) {
            String json = mapper.writeValueAsString(selection);
            assertFalse(json.contains("\"default\""));
            assertEquals(selection, mapper.readValue(json, SkillSelection.class));
            var input = new com.freelanceops.backend.domain.agentrun.client.dto.request.InternalAgentRunRequest.AgentInput(
                "Write a proposal", "en-US", null, null, List.of(), List.of(), selection, "AD_HOC");
            assertEquals(input, mapper.readValue(mapper.writeValueAsString(input),
                com.freelanceops.backend.domain.agentrun.client.dto.request.InternalAgentRunRequest.AgentInput.class));
        }
    }

}
