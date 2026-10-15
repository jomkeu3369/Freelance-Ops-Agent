package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.dto.response.RouteGoldReviewExportResponse;
import com.freelanceops.backend.domain.agentrun.dto.response.RouteObservationExportResponse;
import com.freelanceops.backend.domain.agentrun.dto.response.RouteReviewExportPageResponse;
import com.freelanceops.backend.domain.agentrun.entity.AgentRouteObservationEntity;
import com.freelanceops.backend.domain.agentrun.entity.ModelPricingEntity;
import com.freelanceops.backend.domain.agentrun.model.Provider;
import com.freelanceops.backend.domain.agentrun.repository.AgentRouteObservationRepository;
import com.freelanceops.backend.domain.agentrun.repository.ModelPricingRepository;
import com.freelanceops.backend.domain.workspace.policy.AuthorizationDecision;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import com.freelanceops.backend.domain.workspace.service.WorkspaceAuthorizationService;

import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
public class AgentRouteExportService {
    private final AgentRouteObservationRepository repository;
    private final WorkspaceAuthorizationService authorizationService;
    private final ModelPricingRepository pricingRepository;

    public AgentRouteExportService(
            AgentRouteObservationRepository repository,
            WorkspaceAuthorizationService authorizationService,
            ModelPricingRepository pricingRepository) {
        this.repository = repository;
        this.authorizationService = authorizationService;
        this.pricingRepository = pricingRepository;
    }

    @Transactional(readOnly = true)
    public RouteReviewExportPageResponse exportCohort(
            UUID userId,
            UUID workspaceId,
            Instant since,
            Instant until,
            Instant snapshotAt,
            Instant afterOccurredAt,
            UUID afterId,
            int limit) {
        authorize(userId, workspaceId, PermissionCode.DATA_EXPORT);
        Instant generatedAt = Instant.now();
        Instant fixedSnapshot = snapshotAt == null ? generatedAt : snapshotAt;
        validateExportWindow(
                since, until, fixedSnapshot, generatedAt, afterOccurredAt, afterId, limit);
        PageRequest page = PageRequest.of(0, limit + 1);
        List<AgentRouteObservationEntity> selected =
                afterOccurredAt == null
                        ? repository.findExportPage(workspaceId, since, until, fixedSnapshot, page)
                        : repository.findExportPageAfter(
                                workspaceId,
                                since,
                                until,
                                fixedSnapshot,
                                afterOccurredAt,
                                afterId,
                                page);
        boolean hasMore = selected.size() > limit;
        List<AgentRouteObservationEntity> observations =
                hasMore ? List.copyOf(selected.subList(0, limit)) : List.copyOf(selected);
        List<ModelPricingEntity> pricing =
                pricingRepository.findAllByWorkspaceIdOrderByValidFromDesc(workspaceId);
        List<RouteObservationExportResponse> observationExports =
                observations.stream()
                        .map(observation -> exportObservation(observation, pricing))
                        .toList();
        List<RouteGoldReviewExportResponse> reviewExports =
                observations.stream()
                        .filter(
                                observation ->
                                        observation.reviewedAt() != null
                                                && !observation.reviewedAt().isAfter(fixedSnapshot))
                        .map(
                                observation ->
                                        new RouteGoldReviewExportResponse(
                                                observation.agentRunId(),
                                                observation.agentEventId(),
                                                observation.workspaceId(),
                                                observation.goldRoute(),
                                                observation.correctionSource()))
                        .toList();
        AgentRouteObservationEntity last = observations.isEmpty() ? null : observations.getLast();
        return new RouteReviewExportPageResponse(
                since,
                until,
                fixedSnapshot,
                observationExports,
                reviewExports,
                last == null ? afterOccurredAt : last.occurredAt(),
                last == null ? afterId : last.id(),
                hasMore);
    }

    private static void validateExportWindow(
            Instant since,
            Instant until,
            Instant snapshotAt,
            Instant generatedAt,
            Instant afterOccurredAt,
            UUID afterId,
            int limit) {
        if (since == null || until == null || !until.isAfter(since)) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST, "export requires since before until");
        }
        if (Duration.between(since, until).compareTo(Duration.ofDays(90)) > 0) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST, "export window cannot exceed 90 days");
        }
        if (since.isBefore(generatedAt.minus(Duration.ofDays(365)))
                || snapshotAt.isAfter(generatedAt)
                || snapshotAt.isBefore(until)) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "snapshotAt must be between until and now; since must be within 365 days");
        }
        if ((afterOccurredAt == null) != (afterId == null)) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST, "both export cursor fields are required");
        }
        if (afterOccurredAt != null
                && (afterOccurredAt.isBefore(since) || !afterOccurredAt.isBefore(until))) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST, "export cursor is outside the cohort window");
        }
        if (limit < 1 || limit > 1_000) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST, "export limit must be 1-1000");
        }
    }

    private static RouteObservationExportResponse exportObservation(
            AgentRouteObservationEntity observation, List<ModelPricingEntity> pricing) {
        RoutingCost routingCost = routingCost(observation, pricing);
        return new RouteObservationExportResponse(
                observation.id(),
                observation.agentRunId(),
                observation.agentEventId(),
                observation.workspaceId(),
                observation.projectId(),
                observation.occurredAt(),
                observation.routeData(),
                routingCost.cost(),
                routingCost.pricingId(),
                routingCost.version(),
                routingCost.currency());
    }

    private static RoutingCost routingCost(
            AgentRouteObservationEntity observation, List<ModelPricingEntity> pricing) {
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
        if (!(providerValue instanceof String providerText)
                || !(modelValue instanceof String model)
                || model.isBlank()) {
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT, "routing evaluator pricing identity is incomplete");
        }
        Provider provider;
        try {
            provider = Provider.valueOf(providerText);
        } catch (IllegalArgumentException error) {
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT, "routing evaluator provider is invalid", error);
        }
        ModelPricingEntity match =
                pricing.stream()
                        .filter(
                                candidate ->
                                        candidate.provider() == provider
                                                && candidate.model().equals(model))
                        .filter(
                                candidate ->
                                        !candidate.validFrom().isAfter(observation.occurredAt()))
                        .filter(
                                candidate ->
                                        candidate.validUntil() == null
                                                || candidate
                                                        .validUntil()
                                                        .isAfter(observation.occurredAt()))
                        .findFirst()
                        .orElseThrow(
                                () ->
                                        new ResponseStatusException(
                                                HttpStatus.CONFLICT,
                                                "routing evaluator has no applicable pricing snapshot"));
        if (!"USD".equals(match.currency())) {
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT, "routing evaluator pricing must use USD");
        }
        return new RoutingCost(
                AgentCostService.calculateRouting(inputTokens, outputTokens, match),
                match.id(),
                match.versionLabel(),
                match.currency());
    }

    private static long nonNegativeLong(Object value, String field) {
        if (value == null) return 0;
        if (!(value instanceof Number number)
                || number.longValue() < 0
                || number.doubleValue() != number.longValue()) {
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT, field + " must be a non-negative integer");
        }
        return number.longValue();
    }

    private void authorize(UUID userId, UUID workspaceId, PermissionCode permission) {
        AuthorizationDecision decision =
                authorizationService.authorize(userId, workspaceId, permission);
        if (decision == AuthorizationDecision.ALLOWED) return;
        if (decision == AuthorizationDecision.NOT_FOUND)
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        throw new ResponseStatusException(HttpStatus.FORBIDDEN);
    }

    private record RoutingCost(BigDecimal cost, UUID pricingId, String version, String currency) {}
}
