package com.freelanceops.backend.domain.knowledge.controller;

import com.freelanceops.backend.domain.agentrun.entity.ToolExecutionEntity;
import com.freelanceops.backend.domain.agentrun.model.ToolExecutionStatus;
import com.freelanceops.backend.domain.agentrun.repository.AgentRunRepository;
import com.freelanceops.backend.domain.agentrun.repository.ToolExecutionRepository;
import com.freelanceops.backend.domain.agentrun.service.ToolExecutionAuditService;
import com.freelanceops.backend.domain.internaltool.security.DelegationPrincipal;
import com.freelanceops.backend.domain.internaltool.security.DelegationTokenFilter;
import com.freelanceops.backend.domain.knowledge.dto.request.KnowledgeSearchRequest;
import com.freelanceops.backend.domain.knowledge.service.InternalKnowledgeService;
import com.freelanceops.backend.domain.knowledge.service.KnowledgeService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.mockito.ArgumentCaptor;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import tools.jackson.databind.ObjectMapper;

import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** Controller/advice regression only; genuine JWT and PostgreSQL are covered by the connected suite. */
class InternalKnowledgeExceptionHandlerTest {
    private final KnowledgeService knowledge = mock(KnowledgeService.class);
    private final AgentRunRepository runs = mock(AgentRunRepository.class);
    private final ToolExecutionRepository executions = mock(ToolExecutionRepository.class);
    private final UUID workspaceId = UUID.randomUUID(), runId = UUID.randomUUID();
    private MockMvc mvc;

    @BeforeEach void setup() {
        when(runs.existsByIdAndWorkspaceId(runId, workspaceId)).thenReturn(true);
        when(executions.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        var audit = new ToolExecutionAuditService(executions, runs, new ObjectMapper());
        mvc = MockMvcBuilders.standaloneSetup(new InternalKnowledgeController(new InternalKnowledgeService(knowledge), audit))
            .setControllerAdvice(new InternalKnowledgeExceptionHandler()).build();
    }

    static Stream<Set<String>> insufficientPermissions() {
        return Stream.of(Set.of("agent.run"), Set.of("document.read"), Set.of());
    }

    @ParameterizedTest
    @MethodSource("insufficientPermissions")
    void deniedDelegationReturnsTyped403WithoutReadingKnowledge(Set<String> permissions) throws Exception {
        mvc.perform(post("/internal/v1/knowledge/search")
            .requestAttr(DelegationTokenFilter.PRINCIPAL_ATTRIBUTE, principal(permissions))
            .contentType(MediaType.APPLICATION_JSON).content("{\"query\":\"synthetic query\",\"limit\":10}"))
            .andExpect(status().isForbidden()).andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
            .andExpect(jsonPath("code").value("TOOL_PERMISSION_REQUIRED"))
            .andExpect(jsonPath("detail").value("TOOL_PERMISSION_REQUIRED"));
        verifyNoInteractions(knowledge);
        var saved = ArgumentCaptor.forClass(ToolExecutionEntity.class);
        verify(executions, times(2)).save(saved.capture());
        assertThat(saved.getValue().status()).isEqualTo(ToolExecutionStatus.FAILED);
        assertThat(saved.getValue().errorCode()).isEqualTo("TOOL_PERMISSION_REQUIRED");
    }

    @Test void invalidSearchReturnsTyped400WithoutAuditOrKnowledgeAccess() throws Exception {
        mvc.perform(post("/internal/v1/knowledge/search")
            .requestAttr(DelegationTokenFilter.PRINCIPAL_ATTRIBUTE, principal(Set.of("agent.run", "document.read")))
            .contentType(MediaType.APPLICATION_JSON).content("{\"query\":\"\",\"limit\":0}"))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("code").value("TOOL_INPUT_INVALID"));
        verifyNoInteractions(knowledge, executions, runs);
    }

    @Test void correctlyScopedPermissionsStillReachTheExistingSearch() throws Exception {
        var principal = principal(Set.of("agent.run", "document.read"));
        var query = new KnowledgeSearchRequest("synthetic query", null, 10);
        when(knowledge.search(principal.initiatedBy(), workspaceId, query, principal.projectId(), runId)).thenReturn(List.of());
        mvc.perform(post("/internal/v1/knowledge/search")
            .requestAttr(DelegationTokenFilter.PRINCIPAL_ATTRIBUTE, principal)
            .contentType(MediaType.APPLICATION_JSON).content("{\"query\":\"synthetic query\",\"limit\":10}"))
            .andExpect(status().isOk()).andExpect(content().json("[]"));
        verify(knowledge).search(principal.initiatedBy(), workspaceId, query, principal.projectId(), runId);
    }

    private DelegationPrincipal principal(Set<String> permissions) {
        return new DelegationPrincipal("synthetic", "synthetic-token", runId, workspaceId,
            UUID.randomUUID(), UUID.randomUUID(), permissions);
    }
}
