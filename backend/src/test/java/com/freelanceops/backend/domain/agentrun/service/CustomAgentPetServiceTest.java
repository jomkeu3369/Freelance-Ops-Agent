package com.freelanceops.backend.domain.agentrun.service;

import jakarta.validation.Validation;
import jakarta.validation.ValidatorFactory;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;
import java.util.UUID;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class CustomAgentPetServiceTest {
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final AIConnectionService authorization = mock(AIConnectionService.class);
    private final ValidatorFactory factory = Validation.buildDefaultValidatorFactory();
    private final CustomAgentPetService service = new CustomAgentPetService(jdbc, authorization, new ObjectMapper(), new PetPromptComposer(), factory.getValidator(), 2, 3, 500);
    private final UUID user = UUID.randomUUID(), workspace = UUID.randomUUID();
    @AfterEach void close() { factory.close(); }
    private CustomAgentPetService.Compose input(String prompt) {
        return new CustomAgentPetService.Compose(UUID.randomUUID(), UUID.randomUUID(), 0, prompt, false);
    }

    @Test void previewIsFreeAndDoesNotReadOrWriteBusinessData() {
        var preview = service.preview(user, workspace, input("고양이. 말투: 조용한 선장처럼"));
        verify(authorization).authorize(user, workspace);
        verifyNoInteractions(jdbc);
        assertThat(preview.preferences().communication()).isEqualTo("조용한 선장처럼");
    }

    @Test void revokedAccessBlocksEveryManagementOperationBeforeReadingData() {
        doThrow(new ResponseStatusException(HttpStatus.FORBIDDEN)).when(authorization).authorize(user, workspace);
        var input = input("고양이");
        assertThatThrownBy(() -> service.list(user, workspace)).hasMessageContaining("403");
        assertThatThrownBy(() -> service.preview(user, workspace, input)).hasMessageContaining("403");
        assertThatThrownBy(() -> service.save(user, workspace, input)).hasMessageContaining("403");
        assertThatThrownBy(() -> service.change(user, workspace, input.id(), new CustomAgentPetService.Change("SELECT", 1))).hasMessageContaining("403");
        assertThatThrownBy(() -> service.delete(user, workspace, input.id(), 1)).hasMessageContaining("403");
        assertThatThrownBy(() -> service.runtimeProfiles(user, workspace)).hasMessageContaining("403");
        verifyNoInteractions(jdbc);
    }

    @Test void invalidAndOversizedPromptsNeverReachStorage() {
        assertThatThrownBy(() -> service.save(user, workspace, input(" "))).hasMessageContaining("PET_INVALID_PROMPT");
        assertThatThrownBy(() -> service.preview(user, workspace, input("x".repeat(501)))).hasMessageContaining("PET_INVALID_PROMPT");
        verifyNoInteractions(jdbc);
    }

    @Test void configuredCapacityBlocksSaveBeforeInsert() {
        when(jdbc.queryForObject(contains("AND NOT archived"), eq(Long.class), eq(workspace), eq(user))).thenReturn(2L);
        when(jdbc.queryForObject(endsWith("user_id = ?"), eq(Long.class), eq(workspace), eq(user))).thenReturn(2L);
        assertThatThrownBy(() -> service.save(user, workspace, input("일정 담당"))).hasMessageContaining("PET_ACTIVE_LIMIT");
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }

    @Test void invalidConfigurationFailsAtStartupInsteadOfBeingUnlimited() {
        assertThatThrownBy(() -> new CustomAgentPetService(jdbc, authorization, new ObjectMapper(), new PetPromptComposer(), factory.getValidator(), 0, 3, 500))
            .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new CustomAgentPetService(jdbc, authorization, new ObjectMapper(), new PetPromptComposer(), factory.getValidator(), 3, 2, 500))
            .isInstanceOf(IllegalArgumentException.class);
    }
}
