package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest;
import com.freelanceops.backend.domain.agentrun.dto.response.StartAgentRunResponse;
import com.freelanceops.backend.domain.agentrun.model.AgentRunStatus;

import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import tools.jackson.databind.ObjectMapper;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Service
public class AgentStartIdempotencyService {
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    private record StartRecord(String requestHash, UUID runId, Instant acceptedAt) {}

    /** creditQuote 도입 전에 저장한 요청 해시와 대기 중인 개인 키 시작 요청을 호환한다. */
    private record LegacyStartRequest(
            String requirementText,
            String locale,
            String jurisdictionCode,
            StartAgentRunRequest.ModelSelection modelSelection,
            StartAgentRunRequest.RunBudget budget,
            StartAgentRunRequest.SafetyContext safetyContext) {}

    public AgentStartIdempotencyService(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    /** 시작 데이터를 쓰기 전에 계정 단위 잠금을 잡아 워크스페이스 간 시작 요청과 재시도를 직렬화한다. */
    @Transactional(propagation = Propagation.MANDATORY)
    public Optional<StartAgentRunResponse> replay(
            UUID userId,
            String idempotencyKey,
            UUID workspaceId,
            UUID projectId,
            StartAgentRunRequest request) {
        validateKey(idempotencyKey);
        jdbc.query(
                "SELECT pg_advisory_xact_lock(hashtextextended(?, 0))",
                (row, rowNumber) -> 0,
                "analysis-start:" + userId);
        if (idempotencyKey == null) return Optional.empty();
        List<StartRecord> previous =
                jdbc.query(
                        """
            SELECT request_hash, run_id, accepted_at FROM app.agent_start_idempotency
            WHERE user_id = ? AND idempotency_key = ?
            """,
                        (row, rowNumber) ->
                                new StartRecord(
                                        row.getString(1),
                                        row.getObject(2, UUID.class),
                                        row.getTimestamp(3).toInstant()),
                        userId,
                        idempotencyKey);
        if (previous.isEmpty()) return Optional.empty();
        StartRecord record = previous.getFirst();
        if (!record.requestHash().equals(requestHash(workspaceId, projectId, request))) {
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT,
                    "Idempotency-Key was already used for a different analysis request");
        }
        return Optional.of(
                new StartAgentRunResponse(
                        record.runId(), AgentRunStatus.QUEUED, record.acceptedAt()));
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void rememberStart(
            UUID userId,
            String idempotencyKey,
            UUID workspaceId,
            UUID projectId,
            StartAgentRunRequest request,
            StartAgentRunResponse response) {
        if (idempotencyKey == null) return;
        jdbc.update(
                """
            INSERT INTO app.agent_start_idempotency (user_id, idempotency_key, request_hash, run_id, accepted_at)
            VALUES (?, ?, ?, ?, ?)
            """,
                userId,
                idempotencyKey,
                requestHash(workspaceId, projectId, request),
                response.runId(),
                Timestamp.from(response.acceptedAt()));
    }

    private static void validateKey(String idempotencyKey) {
        if (idempotencyKey != null && !idempotencyKey.matches("[A-Za-z0-9_-]{8,128}")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid Idempotency-Key");
        }
    }

    private String requestHash(UUID workspaceId, UUID projectId, StartAgentRunRequest request) {
        try {
            Object payload =
                    request.creditQuote() == null
                                    && request.attachmentIds().isEmpty()
                                    && request.skillSelection() == null
                                    && request.workflowMode() == null
                                    && request.byokCostNoticeVersion() == null
                            ? new LegacyStartRequest(
                                    request.requirementText(),
                                    request.locale(),
                                    request.jurisdictionCode(),
                                    request.modelSelection(),
                                    request.budget(),
                                    request.safetyContext())
                            : request;
            String input = workspaceId + ":" + projectId + ":" + mapper.writeValueAsString(payload);
            return HexFormat.of()
                    .formatHex(
                            MessageDigest.getInstance("SHA-256")
                                    .digest(input.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException error) {
            throw new IllegalStateException("SHA-256 unavailable", error);
        }
    }
}
