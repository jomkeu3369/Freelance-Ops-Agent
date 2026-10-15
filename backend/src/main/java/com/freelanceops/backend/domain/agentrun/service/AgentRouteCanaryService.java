package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.dto.response.RouteReviewCanaryMetricsResponse;
import com.freelanceops.backend.domain.agentrun.dto.response.WilsonIntervalResponse;
import com.freelanceops.backend.domain.agentrun.repository.AgentRouteReviewVoteRepository;
import com.freelanceops.backend.domain.agentrun.repository.RouteReviewCanaryStatsProjection;
import com.freelanceops.backend.domain.agentrun.repository.RouteReviewCheckpointStatsProjection;
import com.freelanceops.backend.domain.workspace.policy.AuthorizationDecision;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import com.freelanceops.backend.domain.workspace.service.WorkspaceAuthorizationService;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

@Service
public class AgentRouteCanaryService {
    private static final int[] CANARY_CHECKPOINTS = {
        100, 200, 381, 500, 750, 1_000, 1_500, 2_000, 3_000, 5_000, 7_500, 10_000, 15_000, 20_000
    };
    private static final double CANARY_ALPHA_SPENDING_Z = 3.123734630323846;
    private final AgentRouteReviewVoteRepository voteRepository;
    private final WorkspaceAuthorizationService authorizationService;

    public AgentRouteCanaryService(
            AgentRouteReviewVoteRepository voteRepository,
            WorkspaceAuthorizationService authorizationService) {
        this.voteRepository = voteRepository;
        this.authorizationService = authorizationService;
    }

    @Transactional(readOnly = true)
    public RouteReviewCanaryMetricsResponse canaryMetrics(
            UUID userId, UUID workspaceId, Instant since, int checkpoint) {
        authorize(userId, workspaceId, PermissionCode.AGENT_ROUTE_ADJUDICATE);
        Instant generatedAt = Instant.now();
        if (since == null
                || since.isAfter(generatedAt)
                || since.isBefore(generatedAt.minus(Duration.ofDays(365)))) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST, "since must be within the last 365 days");
        }
        if (!isCanaryCheckpoint(checkpoint)) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST, "checkpoint is not pre-registered");
        }
        RouteReviewCanaryStatsProjection stats = voteRepository.canaryStats(workspaceId, since);
        RouteReviewCheckpointStatsProjection checkpointStats =
                voteRepository.checkpointStats(workspaceId, since, checkpoint);
        WilsonIntervalResponse risk =
                wilson(
                        checkpointStats.getRiskOverturns(),
                        checkpointStats.getRiskSampled(),
                        CANARY_ALPHA_SPENDING_Z,
                        checkpointStats.getRiskAvailable() >= checkpoint);
        WilsonIntervalResponse natural =
                wilson(
                        checkpointStats.getNaturalOverturns(),
                        checkpointStats.getNaturalSampled(),
                        CANARY_ALPHA_SPENDING_Z,
                        checkpointStats.getNaturalAvailable() >= checkpoint);
        return new RouteReviewCanaryMetricsResponse(
                since,
                generatedAt,
                checkpoint,
                0.95,
                stats.getCompletedGold(),
                stats.getPendingAdjudications(),
                stats.getSeniorAudits(),
                stats.getDualCompleted(),
                stats.getDisagreements(),
                checkpointStats.getRiskAvailable(),
                checkpointStats.getNaturalAvailable(),
                risk,
                natural,
                overallDecision(risk, natural));
    }

    private static WilsonIntervalResponse wilson(
            long errors, long total, double z, boolean checkpointReached) {
        if (total == 0) return new WilsonIntervalResponse(errors, total, 0, 0, 1, "INCONCLUSIVE");
        double estimate = (double) errors / total;
        double denominator = 1 + z * z / total;
        double centre = estimate + z * z / (2 * total);
        double radius =
                z * Math.sqrt(estimate * (1 - estimate) / total + z * z / (4 * total * total));
        double lower = (centre - radius) / denominator;
        double upper = (centre + radius) / denominator;
        String decision =
                !checkpointReached
                        ? "INCONCLUSIVE"
                        : upper <= 0.01 ? "ACCEPT" : lower > 0.01 ? "REJECT" : "INCONCLUSIVE";
        return new WilsonIntervalResponse(errors, total, estimate, lower, upper, decision);
    }

    private static boolean isCanaryCheckpoint(int checkpoint) {
        for (int candidate : CANARY_CHECKPOINTS) {
            if (candidate == checkpoint) return true;
        }
        return false;
    }

    private static String overallDecision(
            WilsonIntervalResponse risk, WilsonIntervalResponse natural) {
        if ("REJECT".equals(risk.decision()) || "REJECT".equals(natural.decision()))
            return "REJECT";
        if ("ACCEPT".equals(risk.decision()) && "ACCEPT".equals(natural.decision()))
            return "ACCEPT";
        return "INCONCLUSIVE";
    }

    private void authorize(UUID userId, UUID workspaceId, PermissionCode permission) {
        AuthorizationDecision decision =
                authorizationService.authorize(userId, workspaceId, permission);
        if (decision == AuthorizationDecision.ALLOWED) return;
        if (decision == AuthorizationDecision.NOT_FOUND)
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        throw new ResponseStatusException(HttpStatus.FORBIDDEN);
    }
}
