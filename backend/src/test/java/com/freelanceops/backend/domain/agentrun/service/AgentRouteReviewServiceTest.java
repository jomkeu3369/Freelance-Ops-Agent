package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.dto.request.ReviewRouteObservationRequest;
import com.freelanceops.backend.domain.agentrun.entity.AgentRouteObservationEntity;
import com.freelanceops.backend.domain.agentrun.entity.AgentRouteReviewVoteEntity;
import com.freelanceops.backend.domain.agentrun.entity.ModelPricingEntity;
import com.freelanceops.backend.domain.agentrun.model.AgentRouteLabel;
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
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.Pageable;
import org.springframework.web.server.ResponseStatusException;

import java.time.Duration;
import java.time.Instant;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class AgentRouteReviewServiceTest {
    private final AgentRouteObservationRepository repository = mock(AgentRouteObservationRepository.class);
    private final AgentRouteReviewVoteRepository voteRepository = mock(AgentRouteReviewVoteRepository.class);
    private final ModelPricingRepository pricingRepository = mock(ModelPricingRepository.class);
    private final WorkspaceAuthorizationService authorization = mock(WorkspaceAuthorizationService.class);
    private final AgentRouteReviewService service = new AgentRouteReviewService(
        repository, authorization, voteRepository, pricingRepository, Optional.empty()
    );

    @Test
    void exportsFixedSnapshotWithApplicableRoutingPrice() {
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        Instant snapshot = Instant.now().minus(Duration.ofMinutes(1));
        Instant since = snapshot.minus(Duration.ofDays(2));
        Instant until = snapshot.minus(Duration.ofDays(1));
        AgentRouteObservationEntity observation = exportObservation(
            workspaceId, since.plus(Duration.ofHours(1)), snapshot.minus(Duration.ofHours(1))
        );
        UUID pricingId = UUID.randomUUID();
        ModelPricingEntity pricing = new ModelPricingEntity(
            pricingId, workspaceId, Provider.OPENAI, "gpt-5.6-luna", "2026-08-27", "USD",
            new BigDecimal("1.00"), BigDecimal.ZERO, new BigDecimal("10.00"),
            since, null, userId, since
        );
        when(authorization.authorize(userId, workspaceId, PermissionCode.DATA_EXPORT))
            .thenReturn(AuthorizationDecision.ALLOWED);
        when(repository.findExportPage(
            eq(workspaceId), eq(since), eq(until), eq(snapshot), any(Pageable.class)
        )).thenReturn(List.of(observation));
        when(pricingRepository.findAllByWorkspaceIdOrderByValidFromDesc(workspaceId))
            .thenReturn(List.of(pricing));

        var response = service.exportCohort(
            userId, workspaceId, since, until, snapshot, null, null, 100
        );

        assertThat(response.snapshotAt()).isEqualTo(snapshot);
        assertThat(response.hasMore()).isFalse();
        assertThat(response.observations()).hasSize(1);
        assertThat(response.observations().getFirst().routingCostUsd())
            .isEqualByComparingTo("0.00030000");
        assertThat(response.observations().getFirst().pricingSnapshotId()).isEqualTo(pricingId);
        assertThat(response.reviews()).isEmpty();
    }

    @Test
    void exportRejectsMovingOrPartialCursor() {
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        Instant now = Instant.now();
        when(authorization.authorize(userId, workspaceId, PermissionCode.DATA_EXPORT))
            .thenReturn(AuthorizationDecision.ALLOWED);

        assertThatThrownBy(() -> service.exportCohort(
            userId, workspaceId, now.minus(Duration.ofDays(2)), now.minus(Duration.ofDays(1)),
            now.minus(Duration.ofHours(12)), now.minus(Duration.ofHours(36)), null, 100
        )).isInstanceOf(ResponseStatusException.class)
            .extracting(error -> ((ResponseStatusException) error).getStatusCode().value())
            .isEqualTo(400);
    }

    @Test
    void balancesNaturalAndRiskReviewCandidates() {
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        AgentRouteObservationEntity naturalOne = observation(workspaceId, "SIMPLE_LLM");
        AgentRouteObservationEntity naturalTwo = observation(workspaceId, "DIRECT_TOOL");
        AgentRouteObservationEntity riskOne = observation(workspaceId, "HUMAN_REQUIRED");
        AgentRouteObservationEntity riskTwo = observation(workspaceId, "REACT_AGENT");
        when(authorization.authorize(userId, workspaceId, PermissionCode.AGENT_ROUTE_REVIEW))
            .thenReturn(AuthorizationDecision.ALLOWED);
        when(repository.findNaturalPending(workspaceId, 4)).thenReturn(List.of(naturalOne, naturalTwo));
        when(repository.findRiskPending(workspaceId, 4)).thenReturn(List.of(riskOne, riskTwo));

        var pending = service.pending(userId, workspaceId, 4);

        assertThat(pending).extracting(item -> item.routeData().get("route"))
            .containsExactly("SIMPLE_LLM", "HUMAN_REQUIRED", "DIRECT_TOOL", "REACT_AGENT");
    }

    @Test
    void claimsBalancedCandidatesForFifteenMinutes() {
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        AgentRouteObservationEntity natural = observation(workspaceId, "SIMPLE_LLM");
        AgentRouteObservationEntity risk = observation(workspaceId, "HUMAN_REQUIRED");
        when(authorization.authorize(userId, workspaceId, PermissionCode.AGENT_ROUTE_REVIEW))
            .thenReturn(AuthorizationDecision.ALLOWED);
        when(repository.findActiveClaims(
            eq(workspaceId), eq(userId), any(Instant.class), eq(RouteReviewStatus.PENDING), any(Pageable.class)
        )).thenReturn(List.of());
        when(repository.claimNaturalPending(eq(workspaceId), eq(userId), any(Instant.class), eq(2)))
            .thenReturn(List.of(natural));
        when(repository.claimRiskPending(eq(workspaceId), eq(userId), any(Instant.class), eq(2)))
            .thenReturn(List.of(risk));

        var claimed = service.claim(userId, workspaceId, 2);

        assertThat(claimed).extracting(item -> item.routeData().get("route"))
            .containsExactly("SIMPLE_LLM", "HUMAN_REQUIRED");
        assertThat(claimed).allSatisfy(item -> assertThat(item.claimExpiresAt()).isAfter(Instant.now()));
        assertThat(natural.reviewClaimedBy()).isEqualTo(userId);
        assertThat(risk.reviewClaimedBy()).isEqualTo(userId);
    }

    @Test
    void repeatedClaimReturnsActiveWorkWithoutReservingMore() {
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        AgentRouteObservationEntity active = observation(workspaceId, "SIMPLE_LLM");
        active.claimReview(userId, Instant.now(), Duration.ofMinutes(15));
        when(authorization.authorize(userId, workspaceId, PermissionCode.AGENT_ROUTE_REVIEW))
            .thenReturn(AuthorizationDecision.ALLOWED);
        when(repository.findActiveClaims(
            eq(workspaceId), eq(userId), any(Instant.class), eq(RouteReviewStatus.PENDING), any(Pageable.class)
        )).thenReturn(List.of(active));

        var claimed = service.claim(userId, workspaceId, 1);

        assertThat(claimed).hasSize(1);
        assertThat(claimed.getFirst().id()).isEqualTo(active.id());
    }

    @Test
    void repeatedAdjudicationClaimReturnsOnlyActiveAdjudicationWork() {
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        AgentRouteObservationEntity active = observation(workspaceId, "HUMAN_REQUIRED");
        active.claimReview(UUID.randomUUID(), Instant.now(), Duration.ofMinutes(15));
        active.recordVote();
        active.releaseReviewClaim();
        active.claimReview(UUID.randomUUID(), Instant.now(), Duration.ofMinutes(15));
        active.recordVote();
        active.requireAdjudication();
        active.claimReview(userId, Instant.now(), Duration.ofMinutes(15));
        when(authorization.authorize(userId, workspaceId, PermissionCode.AGENT_ROUTE_ADJUDICATE))
            .thenReturn(AuthorizationDecision.ALLOWED);
        when(repository.findActiveClaims(
            eq(workspaceId), eq(userId), any(Instant.class), eq(RouteReviewStatus.ADJUDICATION), any(Pageable.class)
        )).thenReturn(List.of(active));

        var claimed = service.claimAdjudication(userId, workspaceId, 1);

        assertThat(claimed).hasSize(1);
        assertThat(claimed.getFirst().id()).isEqualTo(active.id());
        assertThat(claimed.getFirst().reviewStatus()).isEqualTo(RouteReviewStatus.ADJUDICATION);
    }

    @Test
    void reviewsOnlyScopedObservationOnce() {
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        AgentRouteObservationEntity observation = observation(workspaceId);
        observation.claimReview(userId, Instant.now(), Duration.ofMinutes(15));
        when(authorization.authorize(userId, workspaceId, PermissionCode.AGENT_ROUTE_REVIEW))
            .thenReturn(AuthorizationDecision.ALLOWED);
        when(repository.findScopedForUpdate(observation.id(), workspaceId)).thenReturn(Optional.of(observation));
        ReviewRouteObservationRequest request = new ReviewRouteObservationRequest(
            AgentRouteLabel.HUMAN_REQUIRED, RouteCorrectionSource.HUMAN_REVIEW
        );

        var response = service.review(userId, workspaceId, observation.id(), request);

        assertThat(response.goldRoute()).isEqualTo(AgentRouteLabel.HUMAN_REQUIRED);
        assertThat(response.reviewedAt()).isNotNull();
        assertThatThrownBy(() -> service.review(userId, workspaceId, observation.id(), request))
            .isInstanceOf(ResponseStatusException.class)
            .extracting(error -> ((ResponseStatusException) error).getStatusCode().value())
            .isEqualTo(409);
    }

    @Test
    void matchingBlindVotesCompleteNaturalConsensus() {
        UUID firstReviewer = UUID.randomUUID();
        UUID secondReviewer = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        AgentRouteObservationEntity observation = observation(workspaceId, "SIMPLE_LLM");
        observation.configureReviewTarget(2);
        AgentRouteReviewVoteEntity firstVote = vote(
            workspaceId, observation.id(), firstReviewer, AgentRouteLabel.REACT_AGENT
        );
        when(authorization.authorize(firstReviewer, workspaceId, PermissionCode.AGENT_ROUTE_REVIEW))
            .thenReturn(AuthorizationDecision.ALLOWED);
        when(authorization.authorize(secondReviewer, workspaceId, PermissionCode.AGENT_ROUTE_REVIEW))
            .thenReturn(AuthorizationDecision.ALLOWED);
        when(repository.findScopedForUpdate(observation.id(), workspaceId)).thenReturn(Optional.of(observation));
        when(voteRepository.findByObservationIdOrderByReviewedAtAscIdAsc(observation.id()))
            .thenReturn(List.of(), List.of(firstVote));

        observation.claimReview(firstReviewer, Instant.now(), Duration.ofMinutes(15));
        var first = service.review(
            firstReviewer, workspaceId, observation.id(),
            new ReviewRouteObservationRequest(AgentRouteLabel.REACT_AGENT, RouteCorrectionSource.HUMAN_REVIEW)
        );
        observation.claimReview(secondReviewer, Instant.now(), Duration.ofMinutes(15));
        var second = service.review(
            secondReviewer, workspaceId, observation.id(),
            new ReviewRouteObservationRequest(AgentRouteLabel.REACT_AGENT, RouteCorrectionSource.HUMAN_REVIEW)
        );

        assertThat(first.reviewStatus()).isEqualTo(RouteReviewStatus.PENDING);
        assertThat(first.goldRoute()).isNull();
        assertThat(second.reviewStatus()).isEqualTo(RouteReviewStatus.COMPLETED);
        assertThat(second.reviewVotes()).isEqualTo(2);
        assertThat(second.goldRoute()).isEqualTo(AgentRouteLabel.REACT_AGENT);
    }

    @Test
    void matchingRiskVotesStillRequireSeniorAudit() {
        UUID firstReviewer = UUID.randomUUID();
        UUID secondReviewer = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        AgentRouteObservationEntity observation = observation(workspaceId, "HUMAN_REQUIRED");
        AgentRouteReviewVoteEntity firstVote = vote(
            workspaceId, observation.id(), firstReviewer, AgentRouteLabel.HUMAN_REQUIRED
        );
        when(authorization.authorize(firstReviewer, workspaceId, PermissionCode.AGENT_ROUTE_REVIEW))
            .thenReturn(AuthorizationDecision.ALLOWED);
        when(authorization.authorize(secondReviewer, workspaceId, PermissionCode.AGENT_ROUTE_REVIEW))
            .thenReturn(AuthorizationDecision.ALLOWED);
        when(repository.findScopedForUpdate(observation.id(), workspaceId)).thenReturn(Optional.of(observation));
        when(voteRepository.findByObservationIdOrderByReviewedAtAscIdAsc(observation.id()))
            .thenReturn(List.of(), List.of(firstVote));

        observation.claimReview(firstReviewer, Instant.now(), Duration.ofMinutes(15));
        service.review(
            firstReviewer, workspaceId, observation.id(),
            new ReviewRouteObservationRequest(AgentRouteLabel.HUMAN_REQUIRED, RouteCorrectionSource.HUMAN_REVIEW)
        );
        observation.claimReview(secondReviewer, Instant.now(), Duration.ofMinutes(15));
        var second = service.review(
            secondReviewer, workspaceId, observation.id(),
            new ReviewRouteObservationRequest(AgentRouteLabel.HUMAN_REQUIRED, RouteCorrectionSource.HUMAN_REVIEW)
        );

        assertThat(second.reviewStatus()).isEqualTo(RouteReviewStatus.ADJUDICATION);
        assertThat(second.reviewTarget()).isEqualTo(3);
        assertThat(second.reviewVotes()).isEqualTo(2);
        assertThat(second.goldRoute()).isNull();
    }

    @Test
    void disagreementRequiresThirdReviewerAdjudication() {
        UUID firstReviewer = UUID.randomUUID();
        UUID secondReviewer = UUID.randomUUID();
        UUID adjudicator = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        AgentRouteObservationEntity observation = observation(workspaceId, "HUMAN_REQUIRED");
        AgentRouteReviewVoteEntity firstVote = vote(
            workspaceId, observation.id(), firstReviewer, AgentRouteLabel.REACT_AGENT
        );
        when(authorization.authorize(any(UUID.class), eq(workspaceId), eq(PermissionCode.AGENT_ROUTE_REVIEW)))
            .thenReturn(AuthorizationDecision.ALLOWED);
        when(authorization.authorize(adjudicator, workspaceId, PermissionCode.AGENT_ROUTE_ADJUDICATE))
            .thenReturn(AuthorizationDecision.ALLOWED);
        when(repository.findScopedForUpdate(observation.id(), workspaceId)).thenReturn(Optional.of(observation));
        when(voteRepository.findByObservationIdOrderByReviewedAtAscIdAsc(observation.id()))
            .thenReturn(List.of(), List.of(firstVote), List.of(firstVote));

        observation.claimReview(firstReviewer, Instant.now(), Duration.ofMinutes(15));
        service.review(
            firstReviewer, workspaceId, observation.id(),
            new ReviewRouteObservationRequest(AgentRouteLabel.REACT_AGENT, RouteCorrectionSource.HUMAN_REVIEW)
        );
        observation.claimReview(secondReviewer, Instant.now(), Duration.ofMinutes(15));
        var disagreement = service.review(
            secondReviewer, workspaceId, observation.id(),
            new ReviewRouteObservationRequest(AgentRouteLabel.HUMAN_REQUIRED, RouteCorrectionSource.HUMAN_REVIEW)
        );
        observation.claimReview(adjudicator, Instant.now(), Duration.ofMinutes(15));
        var adjudicated = service.review(
            adjudicator, workspaceId, observation.id(),
            new ReviewRouteObservationRequest(AgentRouteLabel.SUPERVISOR, RouteCorrectionSource.HUMAN_REVIEW)
        );

        assertThat(disagreement.reviewStatus()).isEqualTo(RouteReviewStatus.ADJUDICATION);
        assertThat(disagreement.reviewTarget()).isEqualTo(3);
        assertThat(adjudicated.reviewStatus()).isEqualTo(RouteReviewStatus.COMPLETED);
        assertThat(adjudicated.reviewVotes()).isEqualTo(3);
        assertThat(adjudicated.goldRoute()).isEqualTo(AgentRouteLabel.SUPERVISOR);
    }

    @Test
    void managerCannotAdjudicateWithoutElevatedPermission() {
        UUID reviewer = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        AgentRouteObservationEntity observation = observation(workspaceId, "HUMAN_REQUIRED");
        observation.claimReview(UUID.randomUUID(), Instant.now(), Duration.ofMinutes(15));
        observation.recordVote();
        observation.releaseReviewClaim();
        observation.claimReview(UUID.randomUUID(), Instant.now(), Duration.ofMinutes(15));
        observation.recordVote();
        observation.requireAdjudication();
        observation.claimReview(reviewer, Instant.now(), Duration.ofMinutes(15));
        when(authorization.authorize(reviewer, workspaceId, PermissionCode.AGENT_ROUTE_REVIEW))
            .thenReturn(AuthorizationDecision.ALLOWED);
        when(authorization.authorize(reviewer, workspaceId, PermissionCode.AGENT_ROUTE_ADJUDICATE))
            .thenReturn(AuthorizationDecision.FORBIDDEN);
        when(repository.findScopedForUpdate(observation.id(), workspaceId)).thenReturn(Optional.of(observation));

        assertThatThrownBy(() -> service.review(
            reviewer, workspaceId, observation.id(),
            new ReviewRouteObservationRequest(AgentRouteLabel.SUPERVISOR, RouteCorrectionSource.HUMAN_REVIEW)
        )).isInstanceOf(ResponseStatusException.class)
            .extracting(error -> ((ResponseStatusException) error).getStatusCode().value())
            .isEqualTo(403);
    }

    @Test
    void canaryMetricsAcceptOnlyWhenBothStrataWilsonUpperPasses() {
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        RouteReviewCanaryStatsProjection stats = mock(RouteReviewCanaryStatsProjection.class);
        RouteReviewCheckpointStatsProjection checkpointStats = mock(RouteReviewCheckpointStatsProjection.class);
        when(authorization.authorize(userId, workspaceId, PermissionCode.AGENT_ROUTE_ADJUDICATE))
            .thenReturn(AuthorizationDecision.ALLOWED);
        when(voteRepository.canaryStats(eq(workspaceId), any(Instant.class))).thenReturn(stats);
        when(voteRepository.checkpointStats(eq(workspaceId), any(Instant.class), eq(1_000)))
            .thenReturn(checkpointStats);
        when(stats.getCompletedGold()).thenReturn(1_000L);
        when(stats.getSeniorAudits()).thenReturn(881L);
        when(stats.getDualCompleted()).thenReturn(900L);
        when(checkpointStats.getRiskAvailable()).thenReturn(1_000L);
        when(checkpointStats.getRiskSampled()).thenReturn(1_000L);
        when(checkpointStats.getNaturalAvailable()).thenReturn(1_000L);
        when(checkpointStats.getNaturalSampled()).thenReturn(1_000L);

        var response = service.canaryMetrics(userId, workspaceId, Instant.now().minus(Duration.ofDays(30)), 1_000);

        assertThat(response.riskConsensusOverturn().upper()).isLessThanOrEqualTo(0.01);
        assertThat(response.naturalConsensusOverturn().upper()).isLessThanOrEqualTo(0.01);
        assertThat(response.overallDecision()).isEqualTo("ACCEPT");
    }

    @Test
    void canaryMetricsRemainInconclusiveWithoutBothAuditStrata() {
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        RouteReviewCanaryStatsProjection stats = mock(RouteReviewCanaryStatsProjection.class);
        RouteReviewCheckpointStatsProjection checkpointStats = mock(RouteReviewCheckpointStatsProjection.class);
        when(authorization.authorize(userId, workspaceId, PermissionCode.AGENT_ROUTE_ADJUDICATE))
            .thenReturn(AuthorizationDecision.ALLOWED);
        when(voteRepository.canaryStats(eq(workspaceId), any(Instant.class))).thenReturn(stats);
        when(voteRepository.checkpointStats(eq(workspaceId), any(Instant.class), eq(1_000)))
            .thenReturn(checkpointStats);
        when(checkpointStats.getRiskAvailable()).thenReturn(1_000L);
        when(checkpointStats.getRiskSampled()).thenReturn(1_000L);

        var response = service.canaryMetrics(userId, workspaceId, Instant.now().minus(Duration.ofDays(30)), 1_000);

        assertThat(response.riskConsensusOverturn().decision()).isEqualTo("ACCEPT");
        assertThat(response.naturalConsensusOverturn().decision()).isEqualTo("INCONCLUSIVE");
        assertThat(response.overallDecision()).isEqualTo("INCONCLUSIVE");
    }

    @Test
    void canaryMetricsRejectReachedCheckpointWithHighOverturn() {
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        RouteReviewCanaryStatsProjection stats = mock(RouteReviewCanaryStatsProjection.class);
        RouteReviewCheckpointStatsProjection checkpointStats = mock(RouteReviewCheckpointStatsProjection.class);
        when(authorization.authorize(userId, workspaceId, PermissionCode.AGENT_ROUTE_ADJUDICATE))
            .thenReturn(AuthorizationDecision.ALLOWED);
        when(voteRepository.canaryStats(eq(workspaceId), any(Instant.class))).thenReturn(stats);
        when(voteRepository.checkpointStats(eq(workspaceId), any(Instant.class), eq(100)))
            .thenReturn(checkpointStats);
        when(checkpointStats.getRiskAvailable()).thenReturn(100L);
        when(checkpointStats.getRiskSampled()).thenReturn(100L);
        when(checkpointStats.getRiskOverturns()).thenReturn(10L);

        var response = service.canaryMetrics(userId, workspaceId, Instant.now().minus(Duration.ofDays(30)), 100);

        assertThat(response.riskConsensusOverturn().decision()).isEqualTo("REJECT");
        assertThat(response.overallDecision()).isEqualTo("REJECT");
    }

    @Test
    void canaryMetricsRejectUnregisteredCheckpointAndMovingFutureCohort() {
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        when(authorization.authorize(userId, workspaceId, PermissionCode.AGENT_ROUTE_ADJUDICATE))
            .thenReturn(AuthorizationDecision.ALLOWED);

        assertThatThrownBy(() -> service.canaryMetrics(
            userId, workspaceId, Instant.now().minus(Duration.ofDays(30)), 999
        )).isInstanceOf(ResponseStatusException.class)
            .extracting(error -> ((ResponseStatusException) error).getStatusCode().value())
            .isEqualTo(400);
        assertThatThrownBy(() -> service.canaryMetrics(
            userId, workspaceId, Instant.now().plus(Duration.ofDays(1)), 100
        )).isInstanceOf(ResponseStatusException.class)
            .extracting(error -> ((ResponseStatusException) error).getStatusCode().value())
            .isEqualTo(400);
    }

    @Test
    void rejectsReviewWithoutActiveClaim() {
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        AgentRouteObservationEntity observation = observation(workspaceId);
        when(authorization.authorize(userId, workspaceId, PermissionCode.AGENT_ROUTE_REVIEW))
            .thenReturn(AuthorizationDecision.ALLOWED);
        when(repository.findScopedForUpdate(observation.id(), workspaceId)).thenReturn(Optional.of(observation));

        assertThatThrownBy(() -> service.review(
            userId, workspaceId, observation.id(),
            new ReviewRouteObservationRequest(AgentRouteLabel.SIMPLE_LLM, RouteCorrectionSource.HUMAN_REVIEW)
        )).isInstanceOf(ResponseStatusException.class)
            .extracting(error -> ((ResponseStatusException) error).getStatusCode().value())
            .isEqualTo(409);
    }

    @Test
    void crossWorkspaceObservationIsNotFound() {
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        UUID observationId = UUID.randomUUID();
        when(authorization.authorize(userId, workspaceId, PermissionCode.AGENT_ROUTE_REVIEW))
            .thenReturn(AuthorizationDecision.ALLOWED);
        when(repository.findScopedForUpdate(observationId, workspaceId)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.review(
            userId, workspaceId, observationId,
            new ReviewRouteObservationRequest(AgentRouteLabel.SIMPLE_LLM, RouteCorrectionSource.HUMAN_REVIEW)
        )).isInstanceOf(ResponseStatusException.class)
            .extracting(error -> ((ResponseStatusException) error).getStatusCode().value())
            .isEqualTo(404);
    }

    private static AgentRouteObservationEntity observation(UUID workspaceId) {
        return observation(workspaceId, "SIMPLE_LLM");
    }

    private static AgentRouteObservationEntity observation(UUID workspaceId, String route) {
        UUID observationId = UUID.fromString("00000000-0000-0000-0000-000000000001");
        Map<String, Object> routeData = Map.of("route", route);
        AgentRouteObservationEntity observation = new AgentRouteObservationEntity(
            observationId, workspaceId,
            UUID.randomUUID(), UUID.randomUUID(), 3, Instant.now(),
            routeData, Instant.now()
        );
        observation.configureReviewTarget(new AgentRouteReviewPolicy(0, 0).reviewTarget(observationId, routeData));
        return observation;
    }

    private static AgentRouteObservationEntity exportObservation(UUID workspaceId, Instant occurredAt,
                                                                  Instant capturedAt) {
        return new AgentRouteObservationEntity(
            UUID.randomUUID(), workspaceId, UUID.randomUUID(), UUID.randomUUID(), 7, occurredAt,
            Map.of(
                "route", "SIMPLE_LLM",
                "decisionSource", "LLM_EVALUATOR",
                "evaluatorProvider", "OPENAI",
                "evaluatorModel", "gpt-5.6-luna",
                "routingInputTokens", 100L,
                "routingOutputTokens", 20L,
                "routingLatencyMs", 100.0
            ),
            capturedAt
        );
    }

    private static AgentRouteReviewVoteEntity vote(UUID workspaceId, UUID observationId, UUID reviewerId,
                                                    AgentRouteLabel route) {
        return new AgentRouteReviewVoteEntity(
            UUID.randomUUID(), workspaceId, observationId, reviewerId,
            route, RouteCorrectionSource.HUMAN_REVIEW, Instant.now()
        );
    }
}
