package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.dto.response.AgentChatTurn;
import com.freelanceops.backend.domain.agentrun.dto.response.AgentChatTurn.AttachmentSummary;
import com.freelanceops.backend.domain.agentrun.dto.response.AgentChatTurn.OriginalInputIssue;
import com.freelanceops.backend.domain.agentrun.dto.response.AgentChatTurn.OriginalInputStatus;
import com.freelanceops.backend.domain.agentrun.entity.AgentRunEntity;
import com.freelanceops.backend.domain.agentrun.model.AgentRunCommandType;
import com.freelanceops.backend.domain.agentrun.repository.AgentRunCommandRepository;
import com.freelanceops.backend.domain.agentrun.repository.AgentRunRepository;
import com.freelanceops.backend.domain.project.repository.ProjectRepository;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import com.freelanceops.backend.domain.workspace.repository.WorkspacePermissionReader;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.ObjectReader;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Service
public class AgentRunHistoryService {
    private static final Logger log = LoggerFactory.getLogger(AgentRunHistoryService.class);
    private final WorkspacePermissionReader permissions;
    private final ProjectRepository projects;
    private final AgentRunRepository runs;
    private final AgentRunCommandRepository commands;
    private final ObjectReader historyReader;

    public AgentRunHistoryService(WorkspacePermissionReader permissions, ProjectRepository projects,
                                  AgentRunRepository runs, AgentRunCommandRepository commands, ObjectMapper mapper) {
        this.permissions = permissions;
        this.projects = projects;
        this.runs = runs;
        this.commands = commands;
        this.historyReader = mapper.reader().with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);
    }

    @Transactional(readOnly = true)
    public List<AgentChatTurn> list(UUID userId, UUID workspaceId, UUID projectId, int limit) {
        if (limit < 1 || limit > 50) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "limit must be 1 to 50");
        var membership = permissions.findActiveMembership(userId, workspaceId)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        if (!membership.permissions().contains(PermissionCode.AGENT_RUN)
            || !membership.permissions().contains(PermissionCode.PROJECT_READ)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        }
        if (projects.findByIdAndWorkspaceId(projectId, workspaceId).isEmpty()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
        return runs.findByWorkspaceIdAndProjectIdOrderByCreatedAtDesc(workspaceId, projectId, PageRequest.of(0, limit))
            .stream().map(this::readTurn).toList();
    }

    private AgentChatTurn readTurn(AgentRunEntity run) {
        // Repository failures deliberately propagate. Only historical data decoding is isolated per turn.
        var command = commands.findFirstByRunIdAndCommandTypeOrderByCreatedAtAsc(run.id(), AgentRunCommandType.START);
        if (command.isEmpty()) return unavailable(run, OriginalInputIssue.MISSING_START, List.of());
        String payload = command.get().payload();
        if (payload == null || payload.isBlank()) return unavailable(run, OriginalInputIssue.MALFORMED_PAYLOAD, List.of());
        final JsonNode root;
        try {
            root = historyReader.readTree(payload);
        } catch (JacksonException error) {
            // Never log the exception or payload: parser messages can contain private original input.
            return unavailable(run, OriginalInputIssue.MALFORMED_PAYLOAD, List.of());
        }
        if (root == null || !root.isObject()) return unavailable(run, OriginalInputIssue.MALFORMED_PAYLOAD, List.of());
        JsonNode input = root.get("input");
        if (input == null || !input.isObject()) return unavailable(run, OriginalInputIssue.MISSING_INPUT, List.of());

        // Project display fields only; historical budgets, execution enums and extraction internals
        // are not executable requests and must not be validated against today's execution DTOs.
        var attachments = new ArrayList<AttachmentSummary>();
        boolean invalidAttachments = false;
        JsonNode items = input.get("attachments");
        if (items != null && !items.isNull()) {
            if (!items.isArray()) {
                invalidAttachments = true;
            } else {
                for (JsonNode item : items) {
                    JsonNode name = item.get("name"), status = item.get("status"), notice = item.get("notice");
                    if (!item.isObject() || name == null || !name.isString() || name.stringValue().isBlank()
                        || status == null || !status.isString() || status.stringValue().isBlank()
                        || notice != null && !notice.isNull() && !notice.isString()) {
                        invalidAttachments = true;
                        continue;
                    }
                    attachments.add(new AttachmentSummary(name.stringValue(), status.stringValue(),
                        notice == null || notice.isNull() ? null : notice.stringValue()));
                }
            }
        }
        JsonNode text = input.get("requirementText");
        if (text == null || !text.isString()) return unavailable(run, OriginalInputIssue.INVALID_REQUIREMENT_TEXT, List.copyOf(attachments));
        return turn(run, text.stringValue(), List.copyOf(attachments),
            invalidAttachments ? OriginalInputStatus.PARTIAL : OriginalInputStatus.AVAILABLE,
            invalidAttachments ? OriginalInputIssue.INVALID_ATTACHMENTS : null);
    }

    private AgentChatTurn unavailable(AgentRunEntity run, OriginalInputIssue issue, List<AttachmentSummary> attachments) {
        return turn(run, null, attachments, OriginalInputStatus.UNAVAILABLE, issue);
    }

    private AgentChatTurn turn(AgentRunEntity run, String text, List<AttachmentSummary> attachments,
                               OriginalInputStatus status, OriginalInputIssue issue) {
        if (issue != null) log.warn("Agent run history input degraded: runId={} category={}", run.id(), issue);
        return new AgentChatTurn(run.id(), text, run.status(), run.createdAt(), attachments, status, issue);
    }
}
