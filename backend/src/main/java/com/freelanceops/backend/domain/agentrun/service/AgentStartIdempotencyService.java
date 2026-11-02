package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest;
import com.freelanceops.backend.domain.agentrun.dto.response.StartAgentRunResponse;
import com.freelanceops.backend.domain.agentrun.model.AgentRunStatus;
import com.freelanceops.backend.domain.agentrun.repository.JdbcAgentStartIdempotencyRepository;
import com.freelanceops.backend.domain.agentrun.repository.JdbcAgentStartIdempotencyRepository.StartRecord;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import tools.jackson.databind.ObjectMapper;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Service
public class AgentStartIdempotencyService {
    private final JdbcAgentStartIdempotencyRepository repository;
    private final ObjectMapper mapper;

    /** creditQuote 도입 전에 저장한 요청 해시와 대기 중인 개인 키 시작 요청을 호환한다. */
    private record LegacyStartRequest(
            String requirementText,
            String locale,
            String jurisdictionCode,
            StartAgentRunRequest.ModelSelection modelSelection,
            StartAgentRunRequest.RunBudget budget,
            StartAgentRunRequest.SafetyContext safetyContext) {}

    public AgentStartIdempotencyService(
            JdbcAgentStartIdempotencyRepository repository, ObjectMapper mapper) {
        this.repository = repository;
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
        repository.lockAccount("analysis-start:" + userId);
        if (idempotencyKey == null) return Optional.empty();
        List<StartRecord> previous = repository.findStart(userId, idempotencyKey);
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
        repository.insertStart(
                userId,
                idempotencyKey,
                requestHash(workspaceId, projectId, request),
                response.runId(),
                response.acceptedAt());
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
