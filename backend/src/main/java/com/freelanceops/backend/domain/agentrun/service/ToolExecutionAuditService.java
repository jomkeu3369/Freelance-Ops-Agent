package com.freelanceops.backend.domain.agentrun.service;

import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;
import com.freelanceops.backend.domain.agentrun.entity.ToolExecutionEntity;
import com.freelanceops.backend.domain.agentrun.repository.AgentRunRepository;
import com.freelanceops.backend.domain.agentrun.repository.ToolExecutionRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Instant;
import java.util.Collection;
import java.util.HexFormat;
import java.util.UUID;
import java.util.function.Supplier;

@Service
public class ToolExecutionAuditService {

    private final ToolExecutionRepository executionRepository;
    private final AgentRunRepository runRepository;
    private final ObjectMapper objectMapper;
    private final Clock clock;

    @Autowired
    public ToolExecutionAuditService(ToolExecutionRepository executionRepository, AgentRunRepository runRepository, ObjectMapper objectMapper) {
        this(executionRepository, runRepository, objectMapper, Clock.systemUTC());
    }

    ToolExecutionAuditService(ToolExecutionRepository executionRepository, AgentRunRepository runRepository, ObjectMapper objectMapper, Clock clock) {
        this.executionRepository = executionRepository;
        this.runRepository = runRepository;
        this.objectMapper = objectMapper;
        this.clock = clock;
    }

    public <T> T execute(String toolName, Object input, UUID workspaceId, UUID runId, Supplier<T> operation) {
        requireRunScope(workspaceId, runId);
        Instant startedAt = clock.instant();
        ToolExecutionEntity execution = executionRepository.save(new ToolExecutionEntity(
            UUID.randomUUID(), workspaceId, runId, toolName, hash(input), startedAt
        ));
        try {
            T result = operation.get();
            execution.succeed(summarize(result), clock.instant());
            executionRepository.save(execution);
            return result;
        } catch (RuntimeException error) {
            execution.fail(errorCode(error), clock.instant());
            executionRepository.save(execution);
            throw error;
        }
    }

    private void requireRunScope(UUID workspaceId, UUID runId) {
        if (!runRepository.existsByIdAndWorkspaceId(runId, workspaceId)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "AGENT_RUN_NOT_FOUND");
        }
    }

    private String hash(Object input) {
        try {
            byte[] canonical = objectMapper.writeValueAsString(input).getBytes(StandardCharsets.UTF_8);
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(canonical));
        } catch (JacksonException | NoSuchAlgorithmException error) {
            throw new IllegalStateException("tool input could not be hashed", error);
        }
    }

    private static String summarize(Object result) {
        if (result instanceof Collection<?> collection) return "collection:size=" + collection.size();
        return result == null ? "null" : "type=" + result.getClass().getSimpleName();
    }

    private static String errorCode(RuntimeException error) {
        if (error.getMessage() != null && error.getMessage().matches("[A-Z0-9_]{1,100}")) return error.getMessage();
        return truncate(error.getClass().getSimpleName(), 100);
    }

    private static String truncate(String value, int maxLength) {
        return value.length() <= maxLength ? value : value.substring(0, maxLength);
    }
}
