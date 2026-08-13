package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.dto.request.ResumeAgentRunRequest;
import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView;
import com.freelanceops.backend.domain.agentrun.entity.AgentInterruptionEntity;
import com.freelanceops.backend.domain.agentrun.entity.AgentRunEntity;
import com.freelanceops.backend.domain.agentrun.model.AgentRunStatus;
import com.freelanceops.backend.domain.agentrun.model.InterruptionStatus;
import com.freelanceops.backend.domain.agentrun.repository.AgentInterruptionRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.Map;

@Service
public class AgentInterruptionService {

    private final AgentInterruptionRepository repository;

    public AgentInterruptionService(AgentInterruptionRepository repository) {
        this.repository = repository;
    }

    public void synchronize(AgentRunEntity run, AgentRunView view) {
        AgentRunView.AgentInterruption interruption = view.interruption();
        if (interruption == null) {
            if (isTerminal(view.status())) cancelPending(run);
            return;
        }
        repository.findByIdAndWorkspaceIdAndAgentRunId(interruption.interruptionId(), run.workspaceId(), run.id())
            .ifPresentOrElse(
                existing -> requireSamePayload(existing, interruption),
                () -> create(run, interruption, view.updatedAt())
            );
    }

    public AgentInterruptionEntity requirePending(AgentRunEntity run, ResumeAgentRunRequest request) {
        AgentInterruptionEntity interruption = repository.findByIdAndWorkspaceIdAndAgentRunId(
            request.interruptionId(), run.workspaceId(), run.id()
        ).orElseThrow(() -> new ResponseStatusException(HttpStatus.CONFLICT, "interruption is not active"));
        if (interruption.status() != InterruptionStatus.PENDING) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "interruption was already answered");
        }
        validateAnswers(interruption, request);
        return interruption;
    }

    public void markResponded(AgentInterruptionEntity interruption, ResumeAgentRunRequest request, Instant respondedAt) {
        List<Map<String, Object>> answers = request.answers().stream()
            .map(answer -> Map.<String, Object>of("questionIndex", answer.questionIndex(), "answer", answer.answer()))
            .toList();
        interruption.respond(answers, respondedAt);
        repository.save(interruption);
    }

    public void cancelPending(AgentRunEntity run) {
        repository.findFirstByWorkspaceIdAndAgentRunIdAndStatus(run.workspaceId(), run.id(), InterruptionStatus.PENDING)
            .ifPresent(interruption -> {
                interruption.cancel();
                repository.save(interruption);
            });
    }

    private void create(AgentRunEntity run, AgentRunView.AgentInterruption interruption, Instant createdAt) {
        repository.findFirstByWorkspaceIdAndAgentRunIdAndStatus(run.workspaceId(), run.id(), InterruptionStatus.PENDING)
            .ifPresent(existing -> { throw new ResponseStatusException(HttpStatus.CONFLICT, "another interruption is pending"); });
        repository.save(new AgentInterruptionEntity(
            interruption.interruptionId(), run.workspaceId(), run.id(), interruption.kind(), interruption.questions(), createdAt
        ));
    }

    private static void requireSamePayload(AgentInterruptionEntity existing, AgentRunView.AgentInterruption incoming) {
        if (existing.kind() != incoming.kind() || !existing.questions().equals(incoming.questions())) {
            throw new IllegalStateException("Agent changed an existing interruption payload");
        }
    }

    private static void validateAnswers(AgentInterruptionEntity interruption, ResumeAgentRunRequest request) {
        List<Integer> indices = request.answers().stream().map(ResumeAgentRunRequest.ResumeAnswer::questionIndex).toList();
        if (new HashSet<>(indices).size() != indices.size() || indices.stream().anyMatch(index -> index >= interruption.questions().size())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "answers do not match interruption questions");
        }
    }

    private static boolean isTerminal(AgentRunStatus status) {
        return status == AgentRunStatus.COMPLETED || status == AgentRunStatus.FAILED || status == AgentRunStatus.CANCELLED;
    }
}
