package com.freelanceops.backend.domain.mcp;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView;
import com.freelanceops.backend.domain.agentrun.service.AgentRunGatewayService;
import com.freelanceops.backend.domain.project.dto.response.ProjectResponse;
import com.freelanceops.backend.domain.project.service.ProjectService;
import com.freelanceops.backend.domain.workspace.policy.AuthorizationDecision;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import com.freelanceops.backend.domain.workspace.service.WorkspaceAuthorizationService;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** A deliberately small read-only MCP surface; all reads reuse the existing tenant-aware services. */
@Service
public class McpReadOnlyService {
    private final ProjectService projects;
    private final AgentRunGatewayService runs;
    private final WorkspaceAuthorizationService authorization;
    private final ObjectMapper mapper;

    public McpReadOnlyService(ProjectService projects, AgentRunGatewayService runs,
                              WorkspaceAuthorizationService authorization, ObjectMapper mapper) {
        this.projects = projects;
        this.runs = runs;
        this.authorization = authorization;
        this.mapper = mapper;
    }

    public List<Map<String, Object>> tools(UUID userId, UUID workspaceId) {
        boolean projectRead = permitted(userId, workspaceId, PermissionCode.PROJECT_READ);
        if (!projectRead) return List.of();
        List<Map<String, Object>> projectTools = List.of(
            tool("list_projects", "List projects", "List up to 20 projects in this workspace.", false),
            tool("get_project", "Get project", "Get a project summary in this workspace.", true)
        );
        if (!permitted(userId, workspaceId, PermissionCode.AGENT_RUN)) return projectTools;
        return List.of(projectTools.get(0), projectTools.get(1),
            tool("get_project_progress", "Get project progress", "Get the latest agent run status for a project.", true),
            tool("get_project_result", "Get project result", "Get the latest agent run result for a project.", true));
    }

    public JsonNode call(UUID userId, UUID workspaceId, String name, JsonNode arguments) {
        if (arguments == null || !arguments.isObject()) {
            throw new IllegalArgumentException("arguments must be an object");
        }
        return switch (name) {
            case "list_projects" -> {
                noArguments(arguments);
                List<Map<String, Object>> summaries = projects.list(userId, workspaceId, null).stream()
                    .limit(20).map(McpReadOnlyService::projectSummary).toList();
                yield mapper.valueToTree(Map.of("projects", summaries));
            }
            case "get_project" -> mapper.valueToTree(projectSummary(
                projects.get(userId, workspaceId, projectId(arguments))));
            case "get_project_progress" -> {
                UUID projectId = projectId(arguments);
                AgentRunView run = runs.latestForProject(userId, workspaceId, projectId, newTraceparent()).orElse(null);
                yield mapper.valueToTree(run == null
                    ? Map.of("projectId", projectId, "run", Map.of())
                    : Map.of("projectId", projectId, "run", progress(run)));
            }
            case "get_project_result" -> {
                UUID projectId = projectId(arguments);
                AgentRunView run = runs.latestForProject(userId, workspaceId, projectId, newTraceparent()).orElse(null);
                Map<String, Object> result = new LinkedHashMap<>();
                result.put("projectId", projectId);
                result.put("runId", run == null ? null : run.runId());
                result.put("status", run == null ? null : run.status());
                result.put("result", run == null ? null : run.result());
                yield mapper.valueToTree(result);
            }
            default -> throw new IllegalArgumentException("unknown read-only tool");
        };
    }

    private boolean permitted(UUID userId, UUID workspaceId, PermissionCode permission) {
        AuthorizationDecision decision = authorization.authorize(userId, workspaceId, permission);
        if (decision == AuthorizationDecision.NOT_FOUND) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        return decision == AuthorizationDecision.ALLOWED;
    }

    private static Map<String, Object> projectSummary(ProjectResponse project) {
        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("id", project.id());
        summary.put("title", project.title());
        summary.put("status", project.status());
        summary.put("currency", project.currency());
        summary.put("updatedAt", project.updatedAt());
        return summary;
    }

    private static Map<String, Object> progress(AgentRunView run) {
        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("runId", run.runId());
        summary.put("status", run.status());
        summary.put("activeDepartment", run.activeDepartment());
        summary.put("updatedAt", run.updatedAt());
        return summary;
    }

    private static UUID projectId(JsonNode arguments) {
        if (arguments.size() != 1 || !arguments.path("projectId").isTextual()) {
            throw new IllegalArgumentException("projectId must be the only argument");
        }
        try {
            return UUID.fromString(arguments.get("projectId").textValue());
        } catch (IllegalArgumentException error) {
            throw new IllegalArgumentException("projectId must be a UUID", error);
        }
    }

    private static void noArguments(JsonNode arguments) {
        if (!arguments.isEmpty()) throw new IllegalArgumentException("no arguments are accepted");
    }

    private static String newTraceparent() {
        String traceId = UUID.randomUUID().toString().replace("-", "");
        String spanId = UUID.randomUUID().toString().replace("-", "").substring(0, 16);
        return "00-" + traceId + "-" + spanId + "-01";
    }

    private static Map<String, Object> tool(String name, String title, String description, boolean needsProjectId) {
        Map<String, Object> schema = needsProjectId
            ? Map.of("type", "object", "properties", Map.of("projectId", Map.of("type", "string", "format", "uuid")),
                "required", List.of("projectId"), "additionalProperties", false)
            : Map.of("type", "object", "additionalProperties", false);
        return Map.of("name", name, "title", title, "description", description, "inputSchema", schema,
            "annotations", Map.of("readOnlyHint", true, "destructiveHint", false));
    }
}
