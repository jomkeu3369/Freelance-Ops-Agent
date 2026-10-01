package com.freelanceops.backend.domain.mcp;

import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.CacheControl;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.server.ResponseStatusException;

import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Base64;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * A default-disabled, request-scoped MCP 2026-07-28 Streamable HTTP JSON response endpoint.
 * The application bearer token is required by the existing /api/v2 security chain. This endpoint
 * neither creates sessions nor accepts write tools. See https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http
 */
@RestController
@RequestMapping("/api/v2/workspaces/{workspaceId}/mcp")
@ConditionalOnProperty(name = "app.mcp.read-only.enabled", havingValue = "true")
public class ReadOnlyMcpController {
    static final String VERSION = "2026-07-28";
    private final McpReadOnlyService service;
    private final ObjectMapper mapper;
    private final Set<String> allowedOrigins;

    public ReadOnlyMcpController(McpReadOnlyService service, ObjectMapper mapper,
                                 @Value("${app.mcp.allowed-origins:http://localhost:3000,http://localhost:5173}") String origins) {
        this.service = service;
        this.mapper = mapper;
        this.allowedOrigins = Set.copyOf(Arrays.stream(origins.split(","))
            .map(String::strip).filter(value -> !value.isEmpty()).toList());
        if (allowedOrigins.stream().anyMatch(value -> !value.matches("https?://[^/]+"))) {
            throw new IllegalStateException("MCP origins must be exact HTTP origins");
        }
    }

    @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<JsonNode> post(@PathVariable UUID workspaceId, @RequestBody JsonNode body,
                                         HttpServletRequest request, Authentication authentication) {
        String origin = request.getHeader("Origin");
        if (origin != null && !allowedOrigins.contains(origin)) {
            return error(HttpStatus.FORBIDDEN, null, -32600, "Origin is not allowed");
        }
        String accept = request.getHeader("Accept");
        if (accept == null || !accept.contains(MediaType.APPLICATION_JSON_VALUE)
            || !accept.contains(MediaType.TEXT_EVENT_STREAM_VALUE)) {
            return error(HttpStatus.BAD_REQUEST, null, -32600, "Accept must include application/json and text/event-stream");
        }
        if (body == null || !body.isObject() || !"2.0".equals(body.path("jsonrpc").asText())
            || !validId(body.path("id")) || !body.path("method").isTextual()
            || !body.path("params").isObject()) {
            return error(HttpStatus.BAD_REQUEST, null, -32600, "Invalid JSON-RPC request");
        }
        JsonNode id = body.get("id");
        JsonNode params = body.get("params");
        JsonNode meta = params.path("_meta");
        if (!meta.isObject() || !meta.path("io.modelcontextprotocol/clientCapabilities").isObject()) {
            return error(HttpStatus.BAD_REQUEST, id, -32602, "Required request metadata is missing");
        }
        JsonNode clientInfo = meta.path("io.modelcontextprotocol/clientInfo");
        if (!clientInfo.isMissingNode() && (!clientInfo.isObject() || !clientInfo.path("name").isTextual()
            || !clientInfo.path("version").isTextual())) {
            return error(HttpStatus.BAD_REQUEST, id, -32602, "Client info is malformed");
        }
        String bodyVersion = meta.path("io.modelcontextprotocol/protocolVersion").asText(null);
        String headerVersion = request.getHeader("MCP-Protocol-Version");
        if (bodyVersion == null || headerVersion == null) {
            return error(HttpStatus.BAD_REQUEST, id, -32602, "Protocol version is required");
        }
        if (!headerVersion.equals(bodyVersion)) {
            return error(HttpStatus.BAD_REQUEST, id, -32020, "HeaderMismatch");
        }
        if (!VERSION.equals(bodyVersion)) {
            ObjectNode response = errorNode(id, -32022, "UnsupportedProtocolVersion");
            ((ObjectNode) response.get("error")).set("data", mapper.valueToTree(java.util.Map.of("supportedVersions", List.of(VERSION))));
            return ResponseEntity.badRequest().cacheControl(CacheControl.noStore()).body(response);
        }
        String method = body.path("method").textValue();
        if (!method.equals(request.getHeader("Mcp-Method"))) {
            return error(HttpStatus.BAD_REQUEST, id, -32020, "HeaderMismatch");
        }
        if (!List.of("server/discover", "tools/list", "tools/call").contains(method)) {
            return error(HttpStatus.NOT_FOUND, id, -32601, "Method not found");
        }
        UUID userId = authenticatedUserId(authentication);
        if ("server/discover".equals(method)) {
            // Do not advertise tools to a user who is not a member of this workspace.
            service.tools(userId, workspaceId);
            return success(id, mapper.valueToTree(java.util.Map.of(
                "supportedVersions", List.of(VERSION),
                "capabilities", java.util.Map.of("tools", java.util.Map.of()),
                "ttlMs", 0,
                "cacheScope", "private")));
        }
        if ("tools/list".equals(method)) {
            if (params.has("cursor")) return error(HttpStatus.BAD_REQUEST, id, -32602, "Cursor is not supported");
            return success(id, mapper.valueToTree(java.util.Map.of("tools", service.tools(userId, workspaceId))));
        }
        String name = params.path("name").asText(null);
        if (name == null || !name.equals(decodeHeader(request.getHeader("Mcp-Name")))) {
            return error(HttpStatus.BAD_REQUEST, id, -32020, "HeaderMismatch");
        }
        if (!List.of("list_projects", "get_project", "get_project_progress", "get_project_result").contains(name)) {
            return error(HttpStatus.BAD_REQUEST, id, -32602, "Unknown read-only tool");
        }
        try {
            JsonNode data = service.call(userId, workspaceId, name, params.path("arguments"));
            ObjectNode result = mapper.createObjectNode();
            result.put("resultType", "complete");
            result.set("structuredContent", data);
            result.set("content", mapper.valueToTree(List.of(java.util.Map.of("type", "text", "text", mapper.writeValueAsString(data)))));
            result.put("isError", false);
            return success(id, result);
        } catch (IllegalArgumentException error) {
            return error(HttpStatus.BAD_REQUEST, id, -32602, "Invalid tool arguments");
        } catch (JacksonException error) {
            throw new IllegalStateException("Unable to serialize MCP result", error);
        }
    }

    private ResponseEntity<JsonNode> success(JsonNode id, JsonNode payload) {
        ObjectNode result = mapper.createObjectNode();
        result.put("jsonrpc", "2.0");
        result.set("id", id);
        ObjectNode complete = mapper.createObjectNode();
        complete.put("resultType", "complete");
        complete.setAll((ObjectNode) payload);
        complete.set("_meta", mapper.valueToTree(java.util.Map.of(
            "io.modelcontextprotocol/serverInfo", java.util.Map.of("name", "freelance-ops-read-only", "version", "0.1.0"))));
        result.set("result", complete);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(result);
    }

    private ResponseEntity<JsonNode> error(HttpStatus status, JsonNode id, int code, String message) {
        return ResponseEntity.status(status).cacheControl(CacheControl.noStore()).body(errorNode(id, code, message));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<JsonNode> malformedJson() {
        return error(HttpStatus.BAD_REQUEST, null, -32700, "Parse error");
    }

    private ObjectNode errorNode(JsonNode id, int code, String message) {
        ObjectNode response = mapper.createObjectNode();
        response.put("jsonrpc", "2.0");
        if (id != null) response.set("id", id);
        ObjectNode error = response.putObject("error");
        error.put("code", code);
        error.put("message", message);
        return response;
    }

    private static boolean validId(JsonNode id) {
        return id.isTextual() || id.isIntegralNumber();
    }

    private static String decodeHeader(String value) {
        if (value == null) return null;
        if (!value.startsWith("=?base64?")) return value;
        if (!value.endsWith("?=")) return null;
        try {
            byte[] bytes = Base64.getDecoder().decode(value.substring(9, value.length() - 2));
            return StandardCharsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(bytes)).toString();
        } catch (IllegalArgumentException | CharacterCodingException error) {
            return null;
        }
    }

    private static UUID authenticatedUserId(Authentication authentication) {
        if (authentication == null || !authentication.isAuthenticated()) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        }
        try {
            return UUID.fromString(authentication.getName());
        } catch (IllegalArgumentException error) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Authenticated subject must be a UUID");
        }
    }
}
