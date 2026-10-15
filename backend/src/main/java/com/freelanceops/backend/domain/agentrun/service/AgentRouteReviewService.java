package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.dto.request.ReviewRouteObservationRequest;
import com.freelanceops.backend.domain.agentrun.dto.response.RouteAdjudicationContextResponse;
import com.freelanceops.backend.domain.agentrun.dto.response.RouteObservationReviewResponse;
import com.freelanceops.backend.domain.agentrun.entity.AgentRouteObservationEntity;
import com.freelanceops.backend.domain.agentrun.entity.AgentRouteReviewVoteEntity;
import com.freelanceops.backend.domain.agentrun.model.RouteCorrectionSource;
import com.freelanceops.backend.domain.agentrun.model.RouteReviewStatus;
import com.freelanceops.backend.domain.agentrun.repository.AgentRouteObservationRepository;
import com.freelanceops.backend.domain.agentrun.repository.AgentRouteReviewVoteRepository;
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
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Service
public class AgentRouteReviewService {
    private static final Duration REVIEW_LEASE = Duration.ofMinutes(15);
    private final AgentRouteObservationRepository repository;
    private final WorkspaceAuthorizationService authorizationService;
    private final AgentRouteReviewVoteRepository voteRepository;
    private final Optional<AgentRoutePipelineMetrics> metrics;

    public AgentRouteReviewService(
            AgentRouteObservationRepository repository,
            WorkspaceAuthorizationService authorizationService,
            AgentRouteReviewVoteRepository voteRepository,
            Optional<AgentRoutePipelineMetrics> metrics) {
        this.repository = repository;
        this.authorizationService = authorizationService;
        this.voteRepository = voteRepository;
        this.metrics = metrics;
    }

    @Transactional(readOnly = true)
    public List<RouteObservationReviewResponse> pending(UUID userId, UUID workspaceId, int limit) {
        authorize(userId, workspaceId);
        validateLimit(limit);
        List<AgentRouteObservationEntity> risk = repository.findRiskPending(workspaceId, limit);
        List<AgentRouteObservationEntity> natural =
                repository.findNaturalPending(workspaceId, limit);
        return balanced(risk, natural, limit).stream()
                .map(AgentRouteReviewService::response)
                .toList();
    }

    @Transactional
    public List<RouteObservationReviewResponse> claim(UUID userId, UUID workspaceId, int limit) {
        authorize(userId, workspaceId);
        validateLimit(limit);
        Instant now = Instant.now();
        List<AgentRouteObservationEntity> active =
                repository.findActiveClaims(
                        workspaceId,
                        userId,
                        now,
                        RouteReviewStatus.PENDING,
                        PageRequest.of(0, limit));
        int remaining = limit - active.size();
        if (remaining == 0) return active.stream().map(AgentRouteReviewService::response).toList();
        List<AgentRouteObservationEntity> risk =
                repository.claimRiskPending(workspaceId, userId, now, remaining);
        List<AgentRouteObservationEntity> natural =
                repository.claimNaturalPending(workspaceId, userId, now, remaining);
        List<AgentRouteObservationEntity> claimed = balanced(risk, natural, remaining);
        claimed.forEach(observation -> observation.claimReview(userId, now, REVIEW_LEASE));
        metrics.ifPresent(value -> value.recordClaims(claimed.size()));
        List<AgentRouteObservationEntity> result = new ArrayList<>(active);
        result.addAll(claimed);
        return result.stream().map(AgentRouteReviewService::response).toList();
    }

    @Transactional
    public List<RouteObservationReviewResponse> claimAdjudication(
            UUID userId, UUID workspaceId, int limit) {
        authorize(userId, workspaceId, PermissionCode.AGENT_ROUTE_ADJUDICATE);
        validateLimit(limit);
        Instant now = Instant.now();
        List<AgentRouteObservationEntity> active =
                repository.findActiveClaims(
                        workspaceId,
                        userId,
                        now,
                        RouteReviewStatus.ADJUDICATION,
                        PageRequest.of(0, limit));
        int remaining = limit - active.size();
        if (remaining == 0) return active.stream().map(AgentRouteReviewService::response).toList();
        List<AgentRouteObservationEntity> claimed =
                repository.claimAdjudicationPending(workspaceId, userId, now, remaining);
        claimed.forEach(observation -> observation.claimReview(userId, now, REVIEW_LEASE));
        metrics.ifPresent(value -> value.recordClaims(claimed.size()));
        List<AgentRouteObservationEntity> result = new ArrayList<>(active);
        result.addAll(claimed);
        return result.stream().map(AgentRouteReviewService::response).toList();
    }

    @Transactional(readOnly = true)
    public RouteAdjudicationContextResponse adjudicationContext(
            UUID userId, UUID workspaceId, UUID observationId) {
        authorize(userId, workspaceId, PermissionCode.AGENT_ROUTE_ADJUDICATE);
        AgentRouteObservationEntity observation =
                repository
                        .findScoped(observationId, workspaceId)
                        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        if (observation.reviewStatus() != RouteReviewStatus.ADJUDICATION) {
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT, "route observation is not awaiting adjudication");
        }
        return new RouteAdjudicationContextResponse(
                observation.id(),
                voteRepository
                        .findByObservationIdOrderByReviewedAtAscIdAsc(observation.id())
                        .stream()
                        .map(AgentRouteReviewVoteEntity::goldRoute)
                        .toList());
    }

    @Transactional
    public RouteObservationReviewResponse review(
            UUID userId,
            UUID workspaceId,
            UUID observationId,
            ReviewRouteObservationRequest request) {
        authorize(userId, workspaceId);
        AgentRouteObservationEntity observation =
                repository
                        .findScopedForUpdate(observationId, workspaceId)
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

    private void recordVote(
            AgentRouteObservationEntity observation,
            UUID reviewerId,
            ReviewRouteObservationRequest request) {
        Instant now = Instant.now();
        if (request.correctionSource() == RouteCorrectionSource.POLICY_REPLAY) {
            throw new IllegalArgumentException(
                    "interactive review cannot use POLICY_REPLAY source");
        }
        observation.requireActiveClaim(reviewerId, now);
        if (voteRepository.existsByObservationIdAndReviewerId(observation.id(), reviewerId)) {
            throw new IllegalStateException("reviewer already voted on this observation");
        }
        List<AgentRouteReviewVoteEntity> previous =
                voteRepository.findByObservationIdOrderByReviewedAtAscIdAsc(observation.id());
        voteRepository.save(
                new AgentRouteReviewVoteEntity(
                        UUID.randomUUID(),
                        observation.workspaceId(),
                        observation.id(),
                        reviewerId,
                        request.goldRoute(),
                        request.correctionSource(),
                        now));
        RouteReviewStatus statusBeforeVote = observation.reviewStatus();
        observation.recordVote();
        if (statusBeforeVote == RouteReviewStatus.ADJUDICATION || observation.reviewTarget() == 1) {
            observation.completeReview(
                    request.goldRoute(), request.correctionSource(), reviewerId, now);
        } else if (previous.isEmpty()) {
            observation.releaseReviewClaim();
        } else if (observation.reviewTarget() == 3) {
            observation.requireAdjudication();
        } else if (previous.getFirst().goldRoute() == request.goldRoute()) {
            observation.completeReview(
                    request.goldRoute(), request.correctionSource(), reviewerId, now);
        } else {
            observation.requireAdjudication();
        }
    }

    private void authorize(UUID userId, UUID workspaceId) {
        authorize(userId, workspaceId, PermissionCode.AGENT_ROUTE_REVIEW);
    }

    private void authorize(UUID userId, UUID workspaceId, PermissionCode permission) {
        AuthorizationDecision decision =
                authorizationService.authorize(userId, workspaceId, permission);
        if (decision == AuthorizationDecision.ALLOWED) return;
        if (decision == AuthorizationDecision.NOT_FOUND)
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        throw new ResponseStatusException(HttpStatus.FORBIDDEN);
    }

    private static void validateLimit(int limit) {
        if (limit < 1 || limit > 100)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "limit must be 1-100");
    }

    private static List<AgentRouteObservationEntity> balanced(
            List<AgentRouteObservationEntity> risk,
            List<AgentRouteObservationEntity> natural,
            int limit) {
        List<AgentRouteObservationEntity> selected = new ArrayList<>(limit);
        int riskIndex = 0;
        int naturalIndex = 0;
        while (selected.size() < limit
                && (riskIndex < risk.size() || naturalIndex < natural.size())) {
            if (naturalIndex < natural.size()) selected.add(natural.get(naturalIndex++));
            if (selected.size() < limit && riskIndex < risk.size())
                selected.add(risk.get(riskIndex++));
        }
        return selected;
    }

    private static RouteObservationReviewResponse response(
            AgentRouteObservationEntity observation) {
        return new RouteObservationReviewResponse(
                observation.id(),
                observation.agentRunId(),
                observation.agentEventId(),
                observation.projectId(),
                observation.occurredAt(),
                observation.routeData(),
                observation.goldRoute(),
                observation.correctionSource(),
                observation.reviewedAt(),
                observation.reviewLeaseUntil(),
                observation.reviewTarget(),
                observation.reviewVotes(),
                observation.reviewStatus());
    }
}
