package com.freelanceops.backend.domain.agentrun.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.freelanceops.backend.domain.agentrun.repository.AgentRouteReviewVoteRepository;
import com.freelanceops.backend.domain.agentrun.repository.RouteReviewCanaryStatsProjection;
import com.freelanceops.backend.domain.agentrun.repository.RouteReviewCheckpointStatsProjection;
import com.freelanceops.backend.domain.workspace.policy.AuthorizationDecision;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import com.freelanceops.backend.domain.workspace.service.WorkspaceAuthorizationService;

import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

class AgentRouteCanaryServiceTest {
    private final AgentRouteReviewVoteRepository voteRepository =
            mock(AgentRouteReviewVoteRepository.class);
    private final WorkspaceAuthorizationService authorization =
            mock(WorkspaceAuthorizationService.class);
    private final AgentRouteCanaryService service =
            new AgentRouteCanaryService(voteRepository, authorization);

    @Test
    void hidesWorkspaceWithoutAdjudicationAccessBeforeReadingMetrics() {
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        when(authorization.authorize(userId, workspaceId, PermissionCode.AGENT_ROUTE_ADJUDICATE))
                .thenReturn(AuthorizationDecision.NOT_FOUND);

        assertThatThrownBy(
                        () ->
                                service.canaryMetrics(
                                        userId,
                                        workspaceId,
                                        Instant.now().minus(Duration.ofDays(1)),
                                        100))
                .isInstanceOfSatisfying(
                        ResponseStatusException.class,
                        error -> assertThat(error.getStatusCode().value()).isEqualTo(404));
        verifyNoInteractions(voteRepository);
    }

    @Test
    void canaryMetricsAcceptOnlyWhenBothStrataWilsonUpperPasses() {
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        RouteReviewCanaryStatsProjection stats = mock(RouteReviewCanaryStatsProjection.class);
        RouteReviewCheckpointStatsProjection checkpointStats =
                mock(RouteReviewCheckpointStatsProjection.class);
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

        var response =
                service.canaryMetrics(
                        userId, workspaceId, Instant.now().minus(Duration.ofDays(30)), 1_000);

        assertThat(response.riskConsensusOverturn().upper()).isLessThanOrEqualTo(0.01);
        assertThat(response.naturalConsensusOverturn().upper()).isLessThanOrEqualTo(0.01);
        assertThat(response.overallDecision()).isEqualTo("ACCEPT");
    }

    @Test
    void canaryMetricsRemainInconclusiveWithoutBothAuditStrata() {
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        RouteReviewCanaryStatsProjection stats = mock(RouteReviewCanaryStatsProjection.class);
        RouteReviewCheckpointStatsProjection checkpointStats =
                mock(RouteReviewCheckpointStatsProjection.class);
        when(authorization.authorize(userId, workspaceId, PermissionCode.AGENT_ROUTE_ADJUDICATE))
                .thenReturn(AuthorizationDecision.ALLOWED);
        when(voteRepository.canaryStats(eq(workspaceId), any(Instant.class))).thenReturn(stats);
        when(voteRepository.checkpointStats(eq(workspaceId), any(Instant.class), eq(1_000)))
                .thenReturn(checkpointStats);
        when(checkpointStats.getRiskAvailable()).thenReturn(1_000L);
        when(checkpointStats.getRiskSampled()).thenReturn(1_000L);

        var response =
                service.canaryMetrics(
                        userId, workspaceId, Instant.now().minus(Duration.ofDays(30)), 1_000);

        assertThat(response.riskConsensusOverturn().decision()).isEqualTo("ACCEPT");
        assertThat(response.naturalConsensusOverturn().decision()).isEqualTo("INCONCLUSIVE");
        assertThat(response.overallDecision()).isEqualTo("INCONCLUSIVE");
    }

    @Test
    void canaryMetricsRejectReachedCheckpointWithHighOverturn() {
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        RouteReviewCanaryStatsProjection stats = mock(RouteReviewCanaryStatsProjection.class);
        RouteReviewCheckpointStatsProjection checkpointStats =
                mock(RouteReviewCheckpointStatsProjection.class);
        when(authorization.authorize(userId, workspaceId, PermissionCode.AGENT_ROUTE_ADJUDICATE))
                .thenReturn(AuthorizationDecision.ALLOWED);
        when(voteRepository.canaryStats(eq(workspaceId), any(Instant.class))).thenReturn(stats);
        when(voteRepository.checkpointStats(eq(workspaceId), any(Instant.class), eq(100)))
                .thenReturn(checkpointStats);
        when(checkpointStats.getRiskAvailable()).thenReturn(100L);
        when(checkpointStats.getRiskSampled()).thenReturn(100L);
        when(checkpointStats.getRiskOverturns()).thenReturn(10L);

        var response =
                service.canaryMetrics(
                        userId, workspaceId, Instant.now().minus(Duration.ofDays(30)), 100);

        assertThat(response.riskConsensusOverturn().decision()).isEqualTo("REJECT");
        assertThat(response.overallDecision()).isEqualTo("REJECT");
    }

    @Test
    void canaryMetricsRejectUnregisteredCheckpointAndMovingFutureCohort() {
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        when(authorization.authorize(userId, workspaceId, PermissionCode.AGENT_ROUTE_ADJUDICATE))
                .thenReturn(AuthorizationDecision.ALLOWED);

        assertThatThrownBy(
                        () ->
                                service.canaryMetrics(
                                        userId,
                                        workspaceId,
                                        Instant.now().minus(Duration.ofDays(30)),
                                        999))
                .isInstanceOf(ResponseStatusException.class)
                .extracting(error -> ((ResponseStatusException) error).getStatusCode().value())
                .isEqualTo(400);
        assertThatThrownBy(
                        () ->
                                service.canaryMetrics(
                                        userId,
                                        workspaceId,
                                        Instant.now().plus(Duration.ofDays(1)),
                                        100))
                .isInstanceOf(ResponseStatusException.class)
                .extracting(error -> ((ResponseStatusException) error).getStatusCode().value())
                .isEqualTo(400);
    }
}
