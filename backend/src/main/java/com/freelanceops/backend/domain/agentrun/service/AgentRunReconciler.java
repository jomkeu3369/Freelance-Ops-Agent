package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.client.AgentRunClient;
import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView;
import com.freelanceops.backend.domain.agentrun.entity.AgentRunEntity;
import com.freelanceops.backend.domain.agentrun.model.AgentRunStatus;
import com.freelanceops.backend.domain.agentrun.repository.AgentRunRepository;
import com.freelanceops.backend.domain.agentrun.security.DelegationTokenIssuer;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.util.EnumSet;
import java.util.List;
import java.util.UUID;

@Service
@ConditionalOnProperty(name = "agent.reconciliation-enabled", havingValue = "true", matchIfMissing = true)
public class AgentRunReconciler {

    private static final Logger log = LoggerFactory.getLogger(AgentRunReconciler.class);
    private static final EnumSet<AgentRunStatus> ACTIVE = EnumSet.of(
        AgentRunStatus.QUEUED, AgentRunStatus.RUNNING, AgentRunStatus.WAITING_FOR_USER
    );
    private static final int BATCH_SIZE = 100;
    private final AgentRunRepository repository;
    private final AgentRunClient client;
    private final DelegationTokenIssuer tokenIssuer;
    private final AgentRunProjectionService projectionService;

    public AgentRunReconciler(AgentRunRepository repository, AgentRunClient client,
                              DelegationTokenIssuer tokenIssuer, AgentRunProjectionService projectionService) {
        this.repository = repository;
        this.client = client;
        this.tokenIssuer = tokenIssuer;
        this.projectionService = projectionService;
    }

    @Scheduled(fixedDelayString = "${agent.reconciliation-delay-ms:5000}")
    public void reconcileDueRuns() {
        Instant now = Instant.now();
        List<AgentRunEntity> due = repository.findDueForReconciliation(ACTIVE, now, PageRequest.of(0, BATCH_SIZE));
        for (AgentRunEntity run : due) reconcile(run, now);
    }

    void reconcile(AgentRunEntity run, Instant attemptedAt) {
        try {
            String token = tokenIssuer.issue(
                run.id(), run.workspaceId(), run.projectId(), run.initiatedBy(), List.of(PermissionCode.AGENT_RUN.code())
            );
            AgentRunView view = client.get(run.id(), token, newTraceparent());
            if (view == null || !run.id().equals(view.runId())) {
                throw new IllegalStateException("agent reconciliation response run id does not match");
            }
            projectionService.synchronize(run.id(), run.workspaceId(), view);
        } catch (RuntimeException error) {
            try {
                projectionService.deferReconciliation(run.id(), run.workspaceId(), attemptedAt.plus(Duration.ofSeconds(15)));
            } catch (RuntimeException ignored) {
                // 삭제와 경합해 public run이 사라진 경우에는 더 이상 재조정할 대상이 없다.
            }
            log.debug("Agent run reconciliation deferred: runId={} error={}", run.id(), error.getClass().getSimpleName());
        }
    }

    private static String newTraceparent() {
        String traceId = UUID.randomUUID().toString().replace("-", "") + UUID.randomUUID().toString().replace("-", "");
        String spanId = UUID.randomUUID().toString().replace("-", "").substring(0, 16);
        return "00-" + traceId.substring(0, 32) + "-" + spanId + "-01";
    }
}
