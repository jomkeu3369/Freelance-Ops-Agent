package com.freelanceops.backend.domain.agentrun.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.freelanceops.backend.domain.agentrun.entity.AgentRouteObservationEntity;
import com.freelanceops.backend.domain.agentrun.entity.ModelPricingEntity;
import com.freelanceops.backend.domain.agentrun.model.Provider;
import com.freelanceops.backend.domain.agentrun.repository.AgentRouteObservationRepository;
import com.freelanceops.backend.domain.agentrun.repository.ModelPricingRepository;
import com.freelanceops.backend.domain.workspace.policy.AuthorizationDecision;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import com.freelanceops.backend.domain.workspace.service.WorkspaceAuthorizationService;

import org.junit.jupiter.api.Test;
import org.springframework.data.domain.Pageable;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

class AgentRouteExportServiceTest {
    private final AgentRouteObservationRepository repository =
            mock(AgentRouteObservationRepository.class);
    private final ModelPricingRepository pricingRepository = mock(ModelPricingRepository.class);
    private final WorkspaceAuthorizationService authorization =
            mock(WorkspaceAuthorizationService.class);
    private final AgentRouteExportService service =
            new AgentRouteExportService(repository, authorization, pricingRepository);

    @Test
    void exportsFixedSnapshotWithApplicableRoutingPrice() {
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        Instant snapshot = Instant.now().minus(Duration.ofMinutes(1));
        Instant since = snapshot.minus(Duration.ofDays(2));
        Instant until = snapshot.minus(Duration.ofDays(1));
        AgentRouteObservationEntity observation =
                exportObservation(
                        workspaceId,
                        since.plus(Duration.ofHours(1)),
                        snapshot.minus(Duration.ofHours(1)));
        UUID pricingId = UUID.randomUUID();
        ModelPricingEntity pricing =
                new ModelPricingEntity(
                        pricingId,
                        workspaceId,
                        Provider.OPENAI,
                        "gpt-5.6-luna",
                        "2026-08-27",
                        "USD",
                        new BigDecimal("1.00"),
                        BigDecimal.ZERO,
                        new BigDecimal("10.00"),
                        since,
                        null,
                        userId,
                        since);
        when(authorization.authorize(userId, workspaceId, PermissionCode.DATA_EXPORT))
                .thenReturn(AuthorizationDecision.ALLOWED);
        when(repository.findExportPage(
                        eq(workspaceId), eq(since), eq(until), eq(snapshot), any(Pageable.class)))
                .thenReturn(List.of(observation));
        when(pricingRepository.findAllByWorkspaceIdOrderByValidFromDesc(workspaceId))
                .thenReturn(List.of(pricing));

        var response =
                service.exportCohort(userId, workspaceId, since, until, snapshot, null, null, 100);

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

        assertThatThrownBy(
                        () ->
                                service.exportCohort(
                                        userId,
                                        workspaceId,
                                        now.minus(Duration.ofDays(2)),
                                        now.minus(Duration.ofDays(1)),
                                        now.minus(Duration.ofHours(12)),
                                        now.minus(Duration.ofHours(36)),
                                        null,
                                        100))
                .isInstanceOf(ResponseStatusException.class)
                .extracting(error -> ((ResponseStatusException) error).getStatusCode().value())
                .isEqualTo(400);
    }

    @Test
    void requiresExportPermissionBeforeReadingObservationsOrPrices() {
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        Instant snapshot = Instant.now();
        when(authorization.authorize(userId, workspaceId, PermissionCode.DATA_EXPORT))
                .thenReturn(AuthorizationDecision.FORBIDDEN);

        assertThatThrownBy(
                        () ->
                                service.exportCohort(
                                        userId,
                                        workspaceId,
                                        snapshot.minus(Duration.ofDays(2)),
                                        snapshot.minus(Duration.ofDays(1)),
                                        snapshot,
                                        null,
                                        null,
                                        100))
                .isInstanceOfSatisfying(
                        ResponseStatusException.class,
                        error -> assertThat(error.getStatusCode().value()).isEqualTo(403));
        verifyNoInteractions(repository, pricingRepository);
    }

    @Test
    void rejectsMissingHistoricalPriceInsteadOfExportingZeroCost() {
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        Instant snapshot = Instant.now().minus(Duration.ofMinutes(1));
        Instant since = snapshot.minus(Duration.ofDays(2));
        Instant until = snapshot.minus(Duration.ofDays(1));
        var observation =
                exportObservation(
                        workspaceId,
                        since.plus(Duration.ofHours(1)),
                        snapshot.minus(Duration.ofHours(1)));
        when(authorization.authorize(userId, workspaceId, PermissionCode.DATA_EXPORT))
                .thenReturn(AuthorizationDecision.ALLOWED);
        when(repository.findExportPage(
                        eq(workspaceId), eq(since), eq(until), eq(snapshot), any(Pageable.class)))
                .thenReturn(List.of(observation));
        when(pricingRepository.findAllByWorkspaceIdOrderByValidFromDesc(workspaceId))
                .thenReturn(List.of());

        assertThatThrownBy(
                        () ->
                                service.exportCohort(
                                        userId,
                                        workspaceId,
                                        since,
                                        until,
                                        snapshot,
                                        null,
                                        null,
                                        100))
                .isInstanceOfSatisfying(
                        ResponseStatusException.class,
                        error -> assertThat(error.getStatusCode().value()).isEqualTo(409));
    }

    private static AgentRouteObservationEntity exportObservation(
            UUID workspaceId, Instant occurredAt, Instant capturedAt) {
        return new AgentRouteObservationEntity(
                UUID.randomUUID(),
                workspaceId,
                UUID.randomUUID(),
                UUID.randomUUID(),
                7,
                occurredAt,
                Map.of(
                        "route", "SIMPLE_LLM",
                        "decisionSource", "LLM_EVALUATOR",
                        "evaluatorProvider", "OPENAI",
                        "evaluatorModel", "gpt-5.6-luna",
                        "routingInputTokens", 100L,
                        "routingOutputTokens", 20L,
                        "routingLatencyMs", 100.0),
                capturedAt);
    }
}
