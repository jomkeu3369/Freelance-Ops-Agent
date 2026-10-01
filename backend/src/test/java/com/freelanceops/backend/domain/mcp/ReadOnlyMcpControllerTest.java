package com.freelanceops.backend.domain.mcp;

import tools.jackson.databind.ObjectMapper;
import com.freelanceops.backend.domain.agentrun.service.AgentRunGatewayService;
import com.freelanceops.backend.domain.project.service.ProjectService;
import com.freelanceops.backend.domain.workspace.service.WorkspaceAuthorizationService;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class ReadOnlyMcpControllerTest {
    private final UUID userId = UUID.randomUUID();
    private final UUID workspaceId = UUID.randomUUID();
    private final UUID projectId = UUID.randomUUID();
    private final ObjectMapper mapper = new ObjectMapper();
    private final ProjectService projects = mock(ProjectService.class);
    private final AgentRunGatewayService runs = mock(AgentRunGatewayService.class);
    private final WorkspaceAuthorizationService authorization = mock(WorkspaceAuthorizationService.class);
    private final McpReadOnlyService service = new McpReadOnlyService(projects, runs, authorization, mapper);
    private final MockMvc mvc = MockMvcBuilders.standaloneSetup(
        new ReadOnlyMcpController(service, mapper, "http://localhost:3000")
    ).build();

    @Test
    void listsOnlyAuthorizedReadOnlyTools() throws Exception {
        when(authorization.authorize(userId, workspaceId, com.freelanceops.backend.domain.workspace.policy.PermissionCode.PROJECT_READ))
            .thenReturn(com.freelanceops.backend.domain.workspace.policy.AuthorizationDecision.ALLOWED);
        when(authorization.authorize(userId, workspaceId, com.freelanceops.backend.domain.workspace.policy.PermissionCode.AGENT_RUN))
            .thenReturn(com.freelanceops.backend.domain.workspace.policy.AuthorizationDecision.FORBIDDEN);
        mvc.perform(request("tools/list", null, "", "tools/list", null))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.result.resultType").value("complete"))
            .andExpect(jsonPath("$.result.tools.length()").value(2))
            .andExpect(jsonPath("$.result.tools[0].name").value("list_projects"))
            .andExpect(jsonPath("$.result.tools[1].annotations.readOnlyHint").value(true));
        verifyNoInteractions(projects, runs);
    }

    @Test
    void advertisesOnlyToolsCapabilityWithoutSessionState() throws Exception {
        when(authorization.authorize(userId, workspaceId, com.freelanceops.backend.domain.workspace.policy.PermissionCode.PROJECT_READ))
            .thenReturn(com.freelanceops.backend.domain.workspace.policy.AuthorizationDecision.ALLOWED);
        mvc.perform(request("server/discover", null, "", "server/discover", null))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.result.supportedVersions[0]").value(ReadOnlyMcpController.VERSION))
            .andExpect(jsonPath("$.result.capabilities.tools").isMap())
            .andExpect(jsonPath("$.result.cacheScope").value("private"));
    }

    @Test
    void projectCallUsesAuthenticatedUserAndWorkspacePath() throws Exception {
        when(projects.list(userId, workspaceId, null)).thenReturn(List.of());
        mvc.perform(request("tools/call", "list_projects", "\"arguments\":{},", "tools/call", "list_projects"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.result.structuredContent.projects.length()").value(0));
        verify(projects).list(userId, workspaceId, null);
        verifyNoInteractions(runs);
    }

    @Test
    void crossWorkspaceProjectCannotBeRead() throws Exception {
        when(projects.get(userId, workspaceId, projectId)).thenThrow(new ResponseStatusException(HttpStatus.NOT_FOUND));
        mvc.perform(request("tools/call", "get_project", "\"arguments\":{\"projectId\":\"" + projectId + "\"},", "tools/call", "get_project"))
            .andExpect(status().isNotFound());
        verify(projects).get(userId, workspaceId, projectId);
        verifyNoInteractions(runs);
    }

    @Test
    void nonMemberCannotDiscoverWorkspaceTools() throws Exception {
        when(authorization.authorize(userId, workspaceId, com.freelanceops.backend.domain.workspace.policy.PermissionCode.PROJECT_READ))
            .thenReturn(com.freelanceops.backend.domain.workspace.policy.AuthorizationDecision.NOT_FOUND);
        mvc.perform(request("server/discover", null, "", "server/discover", null))
            .andExpect(status().isNotFound());
        verifyNoInteractions(projects, runs);
    }

    @Test
    void progressAndResultUseScopedReadGatewayWithoutStartingRuns() throws Exception {
        when(runs.latestForProject(eq(userId), eq(workspaceId), eq(projectId), anyString())).thenReturn(Optional.empty());
        String args = "\"arguments\":{\"projectId\":\"" + projectId + "\"},";
        mvc.perform(request("tools/call", "get_project_progress", args, "tools/call", "get_project_progress"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.result.structuredContent.run").isMap());
        mvc.perform(request("tools/call", "get_project_result", args, "tools/call", "get_project_result"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.result.structuredContent.projectId").value(projectId.toString()))
            .andExpect(jsonPath("$.result.structuredContent.result").value(org.hamcrest.Matchers.nullValue()));
        verify(runs, times(2)).latestForProject(eq(userId), eq(workspaceId), eq(projectId),
            argThat(trace -> trace != null && trace.matches("^00-[0-9a-f]{32}-[0-9a-f]{16}-01$")));
        verifyNoInteractions(projects);
    }

    @Test
    void mismatchedHeadersAndInvalidArgumentsCannotReachDomainServices() throws Exception {
        mvc.perform(request("tools/call", "get_project", "\"arguments\":{\"projectId\":\"" + projectId + "\"},", "tools/list", "get_project"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value(-32020));
        mvc.perform(request("tools/call", "get_project", "\"arguments\":{\"projectId\":\"not-a-uuid\"},", "tools/call", "get_project"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value(-32602));
        verifyNoInteractions(projects, runs);
    }

    @Test
    void rejectsBrowserOriginOutsideExactAllowlist() throws Exception {
        mvc.perform(request("tools/list", null, "", "tools/list", null).header("Origin", "https://attacker.example"))
            .andExpect(status().isForbidden());
        verifyNoInteractions(projects, runs, authorization);
    }

    @Test
    void rejectsUnsupportedVersionAndMissingRequestMetadata() throws Exception {
        mvc.perform(post("/api/v2/workspaces/{workspaceId}/mcp", workspaceId)
                .principal(new TestingAuthenticationToken(userId.toString(), "unused", "ROLE_USER"))
                .contentType(MediaType.APPLICATION_JSON)
                .accept(MediaType.APPLICATION_JSON, MediaType.TEXT_EVENT_STREAM)
                .header("MCP-Protocol-Version", "2025-11-25")
                .header("Mcp-Method", "tools/list")
                .content("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\",\"params\":{\"_meta\":{"
                    + "\"io.modelcontextprotocol/protocolVersion\":\"2026-07-28\","
                    + "\"io.modelcontextprotocol/clientCapabilities\":{}}}}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value(-32020));
        mvc.perform(post("/api/v2/workspaces/{workspaceId}/mcp", workspaceId)
                .principal(new TestingAuthenticationToken(userId.toString(), "unused", "ROLE_USER"))
                .contentType(MediaType.APPLICATION_JSON)
                .accept(MediaType.APPLICATION_JSON, MediaType.TEXT_EVENT_STREAM)
                .header("MCP-Protocol-Version", "2025-11-25")
                .header("Mcp-Method", "server/discover")
                .content("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"server/discover\",\"params\":{\"_meta\":{"
                    + "\"io.modelcontextprotocol/protocolVersion\":\"2025-11-25\","
                    + "\"io.modelcontextprotocol/clientCapabilities\":{}}}}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value(-32022))
            .andExpect(jsonPath("$.error.data.supportedVersions[0]").value(ReadOnlyMcpController.VERSION));
        mvc.perform(post("/api/v2/workspaces/{workspaceId}/mcp", workspaceId)
                .principal(new TestingAuthenticationToken(userId.toString(), "unused", "ROLE_USER"))
                .contentType(MediaType.APPLICATION_JSON)
                .accept(MediaType.APPLICATION_JSON, MediaType.TEXT_EVENT_STREAM)
                .header("MCP-Protocol-Version", ReadOnlyMcpController.VERSION)
                .header("Mcp-Method", "tools/list")
                .content("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\",\"params\":{}}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value(-32602));
        verifyNoInteractions(projects, runs, authorization);
    }

    @Test
    void malformedJsonUsesJsonRpcParseError() throws Exception {
        mvc.perform(post("/api/v2/workspaces/{workspaceId}/mcp", workspaceId)
                .principal(new TestingAuthenticationToken(userId.toString(), "unused", "ROLE_USER"))
                .contentType(MediaType.APPLICATION_JSON)
                .accept(MediaType.APPLICATION_JSON, MediaType.TEXT_EVENT_STREAM)
                .content("{"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value(-32700));
    }

    private org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder request(
        String method, String name, String extraParams, String headerMethod, String headerName) {
        String params = "{" + extraParams + (name == null ? "" : "\"name\":\"" + name + "\",")
            + "\"_meta\":{\"io.modelcontextprotocol/protocolVersion\":\"2026-07-28\","
            + "\"io.modelcontextprotocol/clientInfo\":{\"name\":\"test\",\"version\":\"1\"},"
            + "\"io.modelcontextprotocol/clientCapabilities\":{}}}";
        var builder = post("/api/v2/workspaces/{workspaceId}/mcp", workspaceId)
            .principal(new TestingAuthenticationToken(userId.toString(), "unused", "ROLE_USER"))
            .contentType(MediaType.APPLICATION_JSON)
            .accept(MediaType.APPLICATION_JSON, MediaType.TEXT_EVENT_STREAM)
            .header("MCP-Protocol-Version", ReadOnlyMcpController.VERSION)
            .header("Mcp-Method", headerMethod)
            .content("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"" + method + "\",\"params\":" + params + "}");
        return headerName == null ? builder : builder.header("Mcp-Name", headerName);
    }
}
