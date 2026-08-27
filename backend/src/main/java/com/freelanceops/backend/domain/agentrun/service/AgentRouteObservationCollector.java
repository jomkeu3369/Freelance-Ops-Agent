package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.client.AgentRunClient;
import com.freelanceops.backend.domain.agentrun.dto.response.RouteObservationBatch;
import com.freelanceops.backend.domain.agentrun.entity.AgentRunEntity;
import com.freelanceops.backend.domain.agentrun.repository.AgentRunRepository;
import com.freelanceops.backend.domain.agentrun.security.DelegationTokenIssuer;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.Executors;

@Service
@ConditionalOnProperty(name = "agent.route-observation-collection-enabled", havingValue = "true")
public class AgentRouteObservationCollector {
    private static final Logger log = LoggerFactory.getLogger(AgentRouteObservationCollector.class);
    private static final int BATCH_SIZE = 20;
    private final AgentRouteCollectionQueue queue;
    private final AgentRunRepository runRepository;
    private final AgentRunClient client;
    private final DelegationTokenIssuer tokenIssuer;
    private final Optional<AgentRoutePipelineMetrics> metrics;

    public AgentRouteObservationCollector(AgentRouteCollectionQueue queue, AgentRunRepository runRepository,
                                          AgentRunClient client, DelegationTokenIssuer tokenIssuer,
                                          Optional<AgentRoutePipelineMetrics> metrics) {
        this.queue = queue;
        this.runRepository = runRepository;
        this.client = client;
        this.tokenIssuer = tokenIssuer;
        this.metrics = metrics;
    }

    @Scheduled(fixedDelayString = "${agent.route-observation-collection-delay-ms:1000}")
    public void collectPending() {
        List<AgentRouteCollectionQueue.ClaimedCollection> claimed = new ArrayList<>();
        for (int index = 0; index < BATCH_SIZE; index++) {
            Optional<AgentRouteCollectionQueue.ClaimedCollection> next = queue.claimNext();
            if (next.isEmpty()) {
                break;
            }
            claimed.add(next.get());
        }
        if (claimed.isEmpty()) {
            return;
        }
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            for (AgentRouteCollectionQueue.ClaimedCollection claim : claimed) {
                executor.submit(() -> collect(claim));
            }
        }
    }

    void collect(AgentRouteCollectionQueue.ClaimedCollection claim) {
        AgentRunEntity run = runRepository.findById(claim.runId()).orElse(null);
        if (run == null) return;
        String token = tokenIssuer.issue(
            run.id(), run.workspaceId(), run.projectId(), run.initiatedBy(), List.of(PermissionCode.AGENT_RUN.code())
        );
        long startedAt = System.nanoTime();
        try {
            RouteObservationBatch batch = client.routeObservations(
                run.id(), claim.cursorEventId(), token, newTraceparent()
            );
            if (batch == null) throw new IllegalStateException("Agent returned no route observation batch");
            if (queue.record(claim, batch)) {
                metrics.ifPresent(value -> value.recordCollection(batch.events().size(), System.nanoTime() - startedAt));
            }
        } catch (RuntimeException error) {
            queue.retry(claim, retryDelay(claim.attempt()), errorMessage(error));
            metrics.ifPresent(value -> value.recordRetry(System.nanoTime() - startedAt));
            log.debug("Route observation collection deferred: runId={} attempt={}", claim.runId(), claim.attempt());
        }
    }

    private static Duration retryDelay(int attempts) {
        return Duration.ofSeconds(Math.min(60, 1L << Math.min(Math.max(attempts - 1, 0), 6)));
    }

    private static String errorMessage(Throwable error) {
        String message = error.getMessage();
        return error.getClass().getSimpleName() + (message == null ? "" : ": " + message);
    }

    private static String newTraceparent() {
        String traceId = UUID.randomUUID().toString().replace("-", "") + UUID.randomUUID().toString().replace("-", "");
        String spanId = UUID.randomUUID().toString().replace("-", "").substring(0, 16);
        return "00-" + traceId.substring(0, 32) + "-" + spanId + "-01";
    }
}
