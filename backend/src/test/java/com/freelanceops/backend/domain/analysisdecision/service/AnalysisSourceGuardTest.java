package com.freelanceops.backend.domain.analysisdecision.service;

import com.freelanceops.backend.domain.memory.dto.response.MemorySourceMessage;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;
import static org.assertj.core.api.Assertions.*;

class AnalysisSourceGuardTest {
    @Test void ownRunClarificationsAreEvidenceButOtherNewFactsMakeTheSnapshotStale() {
        var original = source(1, "PROJECT_INPUT");
        var runInput = source(2, "RUN_INPUT");
        var ownAnswer = source(3, "USER_CLARIFICATION");
        assertThatCode(() -> AnalysisSourceGuard.requireCurrent(List.of(original, runInput, ownAnswer), List.of(original, ownAnswer))).doesNotThrowAnyException();
        assertThat(AnalysisSourceGuard.eventOrder(List.of(original, runInput, ownAnswer))).isEqualTo(3);
        var newerAnswer = source(4, "USER_CLARIFICATION");
        assertThatThrownBy(() -> AnalysisSourceGuard.requireCurrent(List.of(original, runInput, ownAnswer), List.of(original, ownAnswer, newerAnswer)))
            .isInstanceOf(ResponseStatusException.class);
    }

    @Test void requirementConfirmationsAndOriginalCorrectionsCannotReuseOldOpinions() {
        var original = source(1, "PROJECT_INPUT");
        var runInput = source(2, "RUN_INPUT");
        var confirmed = source(3, "REQUIREMENT_CONFIRMATION");
        assertThatThrownBy(() -> AnalysisSourceGuard.requireCurrent(List.of(original, runInput), List.of(original, confirmed))).isInstanceOf(ResponseStatusException.class);
        assertThatThrownBy(() -> AnalysisSourceGuard.requireCurrent(List.of(original, runInput), List.of(source(4, "PROJECT_INPUT")))).isInstanceOf(ResponseStatusException.class);
        assertThatThrownBy(() -> AnalysisSourceGuard.requireCurrent(List.of(), List.of())).isInstanceOf(ResponseStatusException.class);
    }

    private MemorySourceMessage source(long order, String kind) { return new MemorySourceMessage(UUID.randomUUID(), order, kind, "Original evidence", null, Instant.now()); }
}
