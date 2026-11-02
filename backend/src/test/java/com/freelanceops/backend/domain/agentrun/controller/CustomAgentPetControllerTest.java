package com.freelanceops.backend.domain.agentrun.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.freelanceops.backend.domain.agentrun.dto.PetProfile;
import com.freelanceops.backend.domain.agentrun.dto.request.ComposeCustomAgentPetRequest;
import com.freelanceops.backend.domain.agentrun.dto.response.CustomAgentPetResponse;
import com.freelanceops.backend.domain.agentrun.service.CustomAgentPetService;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.UUID;

class CustomAgentPetControllerTest {
    private final UUID user = UUID.randomUUID();
    private final UUID workspace = UUID.randomUUID();
    private final UUID pet = UUID.randomUUID();
    private final UUID mutation = UUID.randomUUID();
    private final CustomAgentPetService service = mock(CustomAgentPetService.class);
    private final MockMvc mvc =
            MockMvcBuilders.standaloneSetup(new CustomAgentPetController(service)).build();

    @Test
    void existingCreatePayloadKeepsOptionalGenerationIdAndNestedResponse() throws Exception {
        when(service.save(eq(user), eq(workspace), any()))
                .thenReturn(
                        new CustomAgentPetResponse(
                                pet, PetProfile.defaults().getFirst(), false, 1));
        mvc.perform(
                        post("/api/v2/workspaces/" + workspace + "/agent-pets")
                                .principal(
                                        new TestingAuthenticationToken(
                                                user.toString(), "unused", "ROLE_USER"))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                {"id":"%s","mutationId":"%s","expectedRevision":0,
                                 "description":"Careful assistant","resetPreferences":false}
                                """
                                                .formatted(pet, mutation)))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.id").value(pet.toString()))
                .andExpect(jsonPath("$.profile.slot").value("LEAN"))
                .andExpect(jsonPath("$.archived").value(false))
                .andExpect(jsonPath("$.revision").value(1));
        var input = ArgumentCaptor.forClass(ComposeCustomAgentPetRequest.class);
        verify(service).save(eq(user), eq(workspace), input.capture());
        assertThat(input.getValue())
                .isEqualTo(
                        new ComposeCustomAgentPetRequest(
                                pet, mutation, 0, "Careful assistant", false));
        assertThat(input.getValue().generationId()).isNull();
    }

    @Test
    void invalidMutationStillStopsBeforeTheService() throws Exception {
        mvc.perform(
                        patch("/api/v2/workspaces/" + workspace + "/agent-pets/" + pet)
                                .principal(
                                        new TestingAuthenticationToken(
                                                user.toString(), "unused", "ROLE_USER"))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"action\":\"DELETE\",\"expectedRevision\":0}"))
                .andExpect(status().isBadRequest());
        verifyNoInteractions(service);
    }
}
