package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.dto.request.ReviewRouteObservationRequest;
import com.freelanceops.backend.domain.agentrun.dto.response.RouteAdjudicationContextResponse;
import com.freelanceops.backend.domain.agentrun.dto.response.RouteGoldReviewExportResponse;
import com.freelanceops.backend.domain.agentrun.dto.response.RouteObservationExportResponse;
import com.freelanceops.backend.domain.agentrun.dto.response.RouteObservationReviewResponse;
import com.freelanceops.backend.domain.agentrun.dto.response.RouteReviewCanaryMetricsResponse;
import com.freelanceops.backend.domain.agentrun.dto.response.RouteReviewExportPageResponse;
import com.freelanceops.backend.domain.agentrun.dto.response.WilsonIntervalResponse;
import com.freelanceops.backend.domain.agentrun.entity.AgentRouteObservationEntity;
import com.freelanceops.backend.domain.agentrun.entity.AgentRouteReviewVoteEntity;
import com.freelanceops.backend.domain.agentrun.entity.ModelPricingEntity;
import com.freelanceops.backend.domain.agentrun.model.Provider;
import com.freelanceops.backend.domain.agentrun.model.RouteCorrectionSource;
import com.freelanceops.backend.domain.agentrun.model.RouteReviewStatus;
import com.freelanceops.backend.domain.agentrun.repository.AgentRouteObservationRepository;
import com.freelanceops.backend.domain.agentrun.repository.AgentRouteReviewVoteRepository;
import com.freelanceops.backend.domain.agentrun.repository.ModelPricingRepository;
import com.freelanceops.backend.domain.agentrun.repository.RouteReviewCheckpointStatsProjection;
import com.freelanceops.backend.domain.agentrun.repository.RouteReviewCanaryStatsProjection;
import com.freelanceops.backend.domain.workspace.policy.AuthorizationDecision;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import com.freelanceops.backend.domain.workspace.service.WorkspaceAuthorizationService;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.time.Duration;
import java.time.Instant;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@Service
public class AgentRouteReviewService {
    private static final Duration REVIEW_LEASE = Duration.ofMinutes(15);
    private static final int[] CANARY_CHECKPOINTS = {
        100, 200, 381, 500, 750, 1_000, 1_500, 2_000, 3_000, 5_000, 7_500, 10_000, 15_000, 20_000
    };
    private static final double CANARY_ALPHA_SPENDING_Z = 3.123734630323846;
    private final AgentRouteObservationRepository repository;
    private final WorkspaceAuthorizationService authorizationService;
    private final AgentRouteReviewVoteRepository voteRepository;
    private final ModelPricingRepository pricingRepository;
    private final Optional<AgentRoutePipelineMetrics> metrics;

    public AgentRouteReviewService(AgentRouteObservationRepository repository,
                                   WorkspaceAuthorizationService authorizationService,
                                   AgentRouteReviewVoteRepository voteRepository,
                                   ModelPricingRepository pricingRepository,
                                   Optional<AgentRoutePipelineMetrics> metrics) {
        this.repository = repository;
        this.authorizationService = authorizationService;
        this.voteRepository = voteRepository;
        this.pricingRepository = pricingRepository;
        this.metrics = metrics;
    }

    @Transactional(readOnly = true)
    public RouteReviewExportPageResponse exportCohort(UUID userId, UUID workspaceId, Instant since,
                                                       Instant until, Instant snapshotAt,
                                                       Instant afterOccurredAt, UUID afterId, int limit) {
        authorize(userId, workspaceId, PermissionCode.DATA_EXPORT);
        Instant generatedAt = Instant.now();
        Instant fixedSnapshot = snapshotAt == null ? generatedAt : snapshotAt;
        validateExportWindow(since, until, fixedSnapshot, generatedAt, afterOccurredAt, afterId, limit);
        PageRequest page = PageRequest.of(0, limit + 1);
        List<AgentRouteObservationEntity> selected = afterOccurredAt == null
            ? repository.findExportPage(workspaceId, since, until, fixedSnapshot, page)
            : repository.findExportPageAfter(
                workspaceId, since, until, fixedSnapshot, afterOccurredAt, afterId, page
            );
        boolean hasMore = selected.size() > limit;
        List<AgentRouteObservationEntity> observations = hasMore
            ? List.copyOf(selected.subList(0, limit)) : List.copyOf(selected);
        List<ModelPricingEntity> pricing = pricingRepository.findAllByWorkspaceIdOrderByValidFromDesc(workspaceId);
        List<RouteObservationExportResponse> observationExports = observations.stream()
            .map(observation -> exportObservation(observation, pricing))
            .toList();
        List<RouteGoldReviewExportResponse> reviewExports = observations.stream()
            .filter(observation -> observation.reviewedAt() != null
                && !observation.reviewedAt().isAfter(fixedSnapshot))
            .map(observation -> new RouteGoldReviewExportResponse(
                observation.agentRunId(), observation.agentEventId(), observation.workspaceId(),
                observation.goldRoute(), observation.correctionSource()
            ))
            .toList();
        AgentRouteObservationEntity last = observations.isEmpty() ? null : observations.getLast();
        return new RouteReviewExportPageResponse(
            since, until, fixedSnapshot, observationExports, reviewExports,
            last == null ? afterOccurredAt : last.occurredAt(), last == null ? afterId : last.id(), hasMore
        );
    }

    @Transactional(readOnly = true)
    public List<RouteObservationReviewResponse> pending(UUID userId, UUID workspaceId, int limit) {
        authorize(userId, workspaceId);
        validateLimit(limit);
        List<AgentRouteObservationEntity> risk = repository.findRiskPending(workspaceId, limit);
        List<AgentRouteObservationEntity> natural = repository.findNaturalPending(workspaceId, limit);
        return balanced(risk, natural, limit).stream().map(AgentRouteReviewService::response).toList();
    }

    @Transactional
    public List<RouteObservationReviewResponse> claim(UUID userId, UUID workspaceId, int limit) {
        authorize(userId, workspaceId);
        validateLimit(limit);
        Instant now = Instant.now();
        List<AgentRouteObservationEntity> active = repository.findActiveClaims(
            workspaceId, userId, now, RouteReviewStatus.PENDING, PageRequest.of(0, limit)
        );
        int remaining = limit - active.size();
        if (remaining == 0) return active.stream().map(AgentRouteReviewService::response).toList();
        List<AgentRouteObservationEntity> risk = repository.claimRiskPending(workspaceId, userId, now, remaining);
        List<AgentRouteObservationEntity> natural = repository.claimNaturalPending(workspaceId, userId, now, remaining);
        List<AgentRouteObservationEntity> claimed = balanced(risk, natural, remaining);
        claimed.forEach(observation -> observation.claimReview(userId, now, REVIEW_LEASE));
        metrics.ifPresent(value -> value.recordClaims(claimed.size()));
        List<AgentRouteObservationEntity> result = new ArrayList<>(active);
        result.addAll(claimed);
        return result.stream().map(AgentRouteReviewService::response).toList();
    }

    @Transactional
    public List<RouteObservationReviewResponse> claimAdjudication(UUID userId, UUID workspaceId, int limit) {
        authorize(userId, workspaceId, PermissionCode.AGENT_ROUTE_ADJUDICATE);
        validateLimit(limit);
        Instant now = Instant.now();
        List<AgentRouteObservationEntity> active = repository.findActiveClaims(
            workspaceId, userId, now, RouteReviewStatus.ADJUDICATION, PageRequest.of(0, limit)
        );
        int remaining = limit - active.size();
        if (remaining == 0) return active.stream().map(AgentRouteReviewService::response).toList();
        List<AgentRouteObservationEntity> claimed = repository
            .claimAdjudicationPending(workspaceId, userId, now, remaining);
        claimed.forEach(observation -> observation.claimReview(userId, now, REVIEW_LEASE));
        metrics.ifPresent(value -> value.recordClaims(claimed.size()));
        List<AgentRouteObservationEntity> result = new ArrayList<>(active);
        result.addAll(claimed);
        return result.stream().map(AgentRouteReviewService::response).toList();
    }

    @Transactional(readOnly = true)
    public RouteAdjudicationContextResponse adjudicationContext(UUID userId, UUID workspaceId, UUID observationId) {
        authorize(userId, workspaceId, PermissionCode.AGENT_ROUTE_ADJUDICATE);
        AgentRouteObservationEntity observation = repository.findScoped(observationId, workspaceId)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        if (observation.reviewStatus() != RouteReviewStatus.ADJUDICATION) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "route observation is not awaiting adjudication");
        }
        return new RouteAdjudicationContextResponse(
            observation.id(), voteRepository.findByObservationIdOrderByReviewedAtAscIdAsc(observation.id())
                .stream().map(AgentRouteReviewVoteEntity::goldRoute).toList()
        );
    }

    @Transactional(readOnly = true)
    public RouteReviewCanaryMetricsResponse canaryMetrics(UUID userId, UUID workspaceId, Instant since, int checkpoint) {
        authorize(userId, workspaceId, PermissionCode.AGENT_ROUTE_ADJUDICATE);
        Instant generatedAt = Instant.now();
        if (since == null || since.isAfter(generatedAt) || since.isBefore(generatedAt.minus(Duration.ofDays(365)))) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "since must be within the last 365 days");
        }
        if (!isCanaryCheckpoint(checkpoint)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "checkpoint is not pre-registered");
        }
        RouteReviewCanaryStatsProjection stats = voteRepository.canaryStats(workspaceId, since);
        RouteReviewCheckpointStatsProjection checkpointStats = voteRepository.checkpointStats(
            workspaceId, since, checkpoint
        );
        WilsonIntervalResponse risk = wilson(
            checkpointStats.getRiskOverturns(), checkpointStats.getRiskSampled(),
            CANARY_ALPHA_SPENDING_Z, checkpointStats.getRiskAvailable() >= checkpoint
        );
        WilsonIntervalResponse natural = wilson(
            checkpointStats.getNaturalOverturns(), checkpointStats.getNaturalSampled(),
            CANARY_ALPHA_SPENDING_Z, checkpointStats.getNaturalAvailable() >= checkpoint
        );
        return new RouteReviewCanaryMetricsResponse(
            since, generatedAt, checkpoint, 0.95, stats.getCompletedGold(), stats.getPendingAdjudications(),
            stats.getSeniorAudits(), stats.getDualCompleted(), stats.getDisagreements(),
            checkpointStats.getRiskAvailable(), checkpointStats.getNaturalAvailable(),
            risk, natural, overallDecision(risk, natural)
        );
    }

    @Transactional
    public RouteObservationReviewResponse review(UUID userId, UUID workspaceId, UUID observationId,
                                                 ReviewRouteObservationRequest request) {
        authorize(userId, workspaceId);
        AgentRouteObservationEntity observation = repository.findScopedForUpdate(observationId, workspaceId)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        if (observation.reviewStatus() == RouteReviewStatus.ADJUDICATION) {
            authorize(userId, workspaceId, PermissionCode.AGENT_ROUTE_ADJUDICATE);
        }
        try {
            recordVote(observation, userId, request);
        } catch (IllegalStateException error) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, error.getMessage(), error);
        } catch (IllegalArgumentException error) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, error.getMessage(), error);
        }
        metrics.ifPresent(AgentRoutePipelineMetrics::recordReviewVote);
        if (observation.reviewStatus() == RouteReviewStatus.COMPLETED) {
            metrics.ifPresent(AgentRoutePipelineMetrics::recordReviewCompleted);
        }
        return response(observation);
    }

    private void recordVote(AgentRouteObservationEntity observation, UUID reviewerId,
                            ReviewRouteObservationRequest request) {
        Instant now = Instant.now();
        if (request.correctionSource() == RouteCorrectionSource.POLICY_REPLAY) {
            throw new IllegalArgumentException("interactive review cannot use POLICY_REPLAY source");
        }
        observation.requireActiveClaim(reviewerId, now);
        if (voteRepository.existsByObservationIdAndReviewerId(observation.id(), reviewerId)) {
            throw new IllegalStateException("reviewer already voted on this observation");
        }
        List<AgentRouteReviewVoteEntity> previous = voteRepository
            .findByObservationIdOrderByReviewedAtAscIdAsc(observation.id());
        voteRepository.save(new AgentRouteReviewVoteEntity(
            UUID.randomUUID(), observation.workspaceId(), observation.id(), reviewerId,
            request.goldRoute(), request.correctionSource(), now
        ));
        RouteReviewStatus statusBeforeVote = observation.reviewStatus();
        observation.recordVote();
        if (statusBeforeVote == RouteReviewStatus.ADJUDICATION || observation.reviewTarget() == 1) {
            observation.completeReview(request.goldRoute(), request.correctionSource(), reviewerId, now);
        } else if (previous.isEmpty()) {
            observation.releaseReviewClaim();
        } else if (observation.reviewTarget() == 3) {
            observation.requireAdjudication();
        } else if (previous.getFirst().goldRoute() == request.goldRoute()) {
            observation.completeReview(request.goldRoute(), request.correctionSource(), reviewerId, now);
        } else {
            observation.requireAdjudication();
        }
    }

    private void authorize(UUID userId, UUID workspaceId) {
        authorize(userId, workspaceId, PermissionCode.AGENT_ROUTE_REVIEW);
    }

    private static void validateExportWindow(Instant since, Instant until, Instant snapshotAt,
                                             Instant generatedAt, Instant afterOccurredAt,
                                             UUID afterId, int limit) {
        if (since == null || until == null || !until.isAfter(since)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "export requires since before until");
        }
        if (Duration.between(since, until).compareTo(Duration.ofDays(90)) > 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "export window cannot exceed 90 days");
        }
        if (since.isBefore(generatedAt.minus(Duration.ofDays(365))) || snapshotAt.isAfter(generatedAt)
            || snapshotAt.isBefore(until)) {
            throw new ResponseStatusException(
                HttpStatus.BAD_REQUEST, "snapshotAt must be between until and now; since must be within 365 days"
            );
        }
        if ((afterOccurredAt == null) != (afterId == null)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "both export cursor fields are required");
        }
        if (afterOccurredAt != null && (afterOccurredAt.isBefore(since) || !afterOccurredAt.isBefore(until))) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "export cursor is outside the cohort window");
        }
        if (limit < 1 || limit > 1_000) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "export limit must be 1-1000");
        }
    }

    private static RouteObservationExportResponse exportObservation(AgentRouteObservationEntity observation,
                                                                     List<ModelPricingEntity> pricing) {
        RoutingCost routingCost = routingCost(observation, pricing);
        return new RouteObservationExportResponse(
            observation.id(), observation.agentRunId(), observation.agentEventId(), observation.workspaceId(),
            observation.projectId(), observation.occurredAt(), observation.routeData(),
            routingCost.cost(), routingCost.pricingId(), routingCost.version(), routingCost.currency()
        );
    }

    private static RoutingCost routingCost(AgentRouteObservationEntity observation,
                                           List<ModelPricingEntity> pricing) {
        Map<String, Object> data = observation.routeData();
        if ("POLICY_GATE".equals(data.get("decisionSource"))) {
            return new RoutingCost(BigDecimal.ZERO, null, null, null);
        }
        long inputTokens = nonNegativeLong(data.get("routingInputTokens"), "routingInputTokens");
        long outputTokens = nonNegativeLong(data.get("routingOutputTokens"), "routingOutputTokens");
        Object providerValue = data.get("evaluatorProvider");
        Object modelValue = data.get("evaluatorModel");
        if (providerValue == null && modelValue == null && inputTokens == 0 && outputTokens == 0) {
            return new RoutingCost(BigDecimal.ZERO, null, null, null);
        }
        if (!(providerValue instanceof String providerText) || !(modelValue instanceof String model)
            || model.isBlank()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "routing evaluator pricing identity is incomplete");
        }
        Provider provider;
        try {
            provider = Provider.valueOf(providerText);
        } catch (IllegalArgumentException error) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "routing evaluator provider is invalid", error);
        }
        ModelPricingEntity match = pricing.stream()
            .filter(candidate -> candidate.provider() == provider && candidate.model().equals(model))
            .filter(candidate -> !candidate.validFrom().isAfter(observation.occurredAt()))
            .filter(candidate -> candidate.validUntil() == null
                || candidate.validUntil().isAfter(observation.occurredAt()))
            .findFirst()
            .orElseThrow(() -> new ResponseStatusException(
                HttpStatus.CONFLICT, "routing evaluator has no applicable pricing snapshot"
            ));
        if (!"USD".equals(match.currency())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "routing evaluator pricing must use USD");
        }
        return new RoutingCost(
            AgentCostService.calculateRouting(inputTokens, outputTokens, match),
            match.id(), match.versionLabel(), match.currency()
        );
    }

    private static long nonNegativeLong(Object value, String field) {
        if (value == null) return 0;
        if (!(value instanceof Number number) || number.longValue() < 0
            || number.doubleValue() != number.longValue()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, field + " must be a non-negative integer");
        }
        return number.longValue();
    }

    private void authorize(UUID userId, UUID workspaceId, PermissionCode permission) {
        AuthorizationDecision decision = authorizationService.authorize(
            userId, workspaceId, permission
        );
        if (decision == AuthorizationDecision.ALLOWED) return;
        if (decision == AuthorizationDecision.NOT_FOUND) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        throw new ResponseStatusException(HttpStatus.FORBIDDEN);
    }

    private static void validateLimit(int limit) {
        if (limit < 1 || limit > 100) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "limit must be 1-100");
    }

    private static WilsonIntervalResponse wilson(long errors, long total, double z, boolean checkpointReached) {
        if (total == 0) return new WilsonIntervalResponse(errors, total, 0, 0, 1, "INCONCLUSIVE");
        double estimate = (double) errors / total;
        double denominator = 1 + z * z / total;
        double centre = estimate + z * z / (2 * total);
        double radius = z * Math.sqrt(
            estimate * (1 - estimate) / total + z * z / (4 * total * total)
        );
        double lower = (centre - radius) / denominator;
        double upper = (centre + radius) / denominator;
        String decision = !checkpointReached ? "INCONCLUSIVE"
            : upper <= 0.01 ? "ACCEPT" : lower > 0.01 ? "REJECT" : "INCONCLUSIVE";
        return new WilsonIntervalResponse(errors, total, estimate, lower, upper, decision);
    }

    private static boolean isCanaryCheckpoint(int checkpoint) {
        for (int candidate : CANARY_CHECKPOINTS) {
            if (candidate == checkpoint) return true;
        }
        return false;
    }

    private static String overallDecision(WilsonIntervalResponse risk, WilsonIntervalResponse natural) {
        if ("REJECT".equals(risk.decision()) || "REJECT".equals(natural.decision())) return "REJECT";
        if ("ACCEPT".equals(risk.decision()) && "ACCEPT".equals(natural.decision())) return "ACCEPT";
        return "INCONCLUSIVE";
    }

    private static List<AgentRouteObservationEntity> balanced(List<AgentRouteObservationEntity> risk,
                                                               List<AgentRouteObservationEntity> natural,
                                                               int limit) {
        List<AgentRouteObservationEntity> selected = new ArrayList<>(limit);
        int riskIndex = 0;
        int naturalIndex = 0;
        while (selected.size() < limit && (riskIndex < risk.size() || naturalIndex < natural.size())) {
            if (naturalIndex < natural.size()) selected.add(natural.get(naturalIndex++));
            if (selected.size() < limit && riskIndex < risk.size()) selected.add(risk.get(riskIndex++));
        }
        return selected;
    }

    private static RouteObservationReviewResponse response(AgentRouteObservationEntity observation) {
        return new RouteObservationReviewResponse(
            observation.id(), observation.agentRunId(), observation.agentEventId(), observation.projectId(),
            observation.occurredAt(), observation.routeData(), observation.goldRoute(),
            observation.correctionSource(), observation.reviewedAt(), observation.reviewLeaseUntil(),
            observation.reviewTarget(), observation.reviewVotes(), observation.reviewStatus()
        );
    }

    private record RoutingCost(BigDecimal cost, UUID pricingId, String version, String currency) { }
}
