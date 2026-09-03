package com.freelanceops.backend.domain.agenttask.service;

import com.freelanceops.backend.domain.agentrun.repository.AgentRunRepository;
import com.freelanceops.backend.domain.agentrun.security.DelegationTokenIssuer;
import com.freelanceops.backend.domain.agenttask.entity.AgentTaskEntity;
import com.freelanceops.backend.domain.agenttask.entity.AgentTaskExecutionProfileId;
import com.freelanceops.backend.domain.agenttask.model.AgentTaskStatus;
import com.freelanceops.backend.domain.agenttask.repository.AgentTaskAttemptRepository;
import com.freelanceops.backend.domain.agenttask.repository.AgentTaskExecutionProfileRepository;
import com.freelanceops.backend.domain.agenttask.repository.AgentTaskRepository;
import com.freelanceops.backend.domain.internaltool.security.DelegationPrincipal;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Set;
import java.util.UUID;

@Service
@ConditionalOnProperty(name = "agent.research-recovery-enabled", havingValue = "true")
public class ResearchRecoveryDispatcher {

    private static final Logger log = LoggerFactory.getLogger(ResearchRecoveryDispatcher.class);
    private static final int BATCH_SIZE = 20;
    private static final List<AgentTaskStatus> ACTIVE = List.of(AgentTaskStatus.QUEUED, AgentTaskStatus.DISPATCHED, AgentTaskStatus.RUNNING);
    private final AgentTaskRepository tasks;
    private final AgentTaskAttemptRepository attempts;
    private final AgentTaskExecutionProfileRepository profiles;
    private final AgentRunRepository runs;
    private final AgentTaskGuard guard;
    private final DelegationTokenIssuer issuer;
    private final ResearchRecoveryClient client;
    private final List<UUID> workspaces;
    private UUID afterId;

    public ResearchRecoveryDispatcher(AgentTaskRepository tasks, AgentTaskAttemptRepository attempts, AgentTaskExecutionProfileRepository profiles, AgentRunRepository runs, AgentTaskGuard guard, DelegationTokenIssuer issuer, ResearchRecoveryClient client, @Value("${agent.research-recovery-workspaces:}") String workspaces) {
        this.tasks = tasks;
        this.attempts = attempts;
        this.profiles = profiles;
        this.runs = runs;
        this.guard = guard;
        this.issuer = issuer;
        this.client = client;
        this.workspaces = Arrays.stream(workspaces.split(",")).map(String::trim).filter(value -> !value.isEmpty()).map(UUID::fromString).distinct().toList();
        if (this.workspaces.isEmpty()) throw new IllegalArgumentException("Research recovery requires an explicit workspace allowlist");
    }

    @Scheduled(fixedDelayString = "${agent.research-recovery-delay-ms:10000}")
    public void refresh() {
        List<AgentTaskEntity> batch = tasks.findRecoveryAndReplayCandidates(workspaces, ACTIVE, afterId, Instant.now().minusSeconds(86400), PageRequest.of(0, BATCH_SIZE));
        for (AgentTaskEntity task : batch) {
            afterId = task.id();
            try {
                restore(task);
            } catch (RuntimeException error) {
                // Never log HTTP bodies, tokens, objectives, or exception messages.
                log.warn("Research recovery deferred: taskId={} errorType={}", task.id(), error.getClass().getSimpleName());
            }
        }
        if (batch.size() < BATCH_SIZE) afterId = null;
    }

    void restore(AgentTaskEntity candidate) {
        AgentTaskEntity task = tasks.findByIdAndWorkspaceId(candidate.id(), candidate.workspaceId()).orElseThrow();
        if (!workspaces.contains(task.workspaceId()) || !"research-read-v1".equals(task.specialistProfile())) return;
        var run = runs.findByIdAndWorkspaceId(task.runId(), task.workspaceId()).orElseThrow();
        var profile = profiles.findById(new AgentTaskExecutionProfileId(task.id(), task.revision())).orElseThrow();
        var attempt = attempts.findByTaskIdAndTaskRevisionAndAttemptNumber(task.id(), task.revision(), task.currentAttemptNumber()).orElseThrow();
        if (!attempt.workspaceId().equals(task.workspaceId())) throw new IllegalStateException("Research attempt scope is invalid");
        // validate reads CURRENT membership, policy and parent budget. A changed revision requires re-admission.
        var principal = new DelegationPrincipal(run.initiatedBy().toString(), "internal-recovery-check", run.id(),
            run.workspaceId(), run.projectId(), run.initiatedBy(), Set.copyOf(profile.permissions()));
        var request = new ResearchRecoveryClient.RecoveryRequest(task.id(), task.revision(), attempt.id(), profile.authorizationRevision(), profile.budgetRevision());
        boolean executable = ACTIVE.contains(task.status());
        try {
            executable = executable && profile.hasSameContract(guard.validate(task, profile.asRequest(), principal, Instant.now()));
        } catch (ResponseStatusException | IllegalStateException rejected) {
            executable = false;
        }
        if (!executable) {
            String reportToken = issuer.issue(run.id(), run.workspaceId(), run.projectId(), run.initiatedBy(), List.of("agent.task.report"));
            client.replay(run.id(), request, reportToken);
            return;
        }
        List<String> permissions = new ArrayList<>(profile.permissions());
        permissions.add("agent.task.recover");
        String token = issuer.issue(run.id(), run.workspaceId(), run.projectId(), run.initiatedBy(), permissions);
        client.restore(run.id(), request, token);
    }
}
