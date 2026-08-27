package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunEvent;
import com.freelanceops.backend.domain.agentrun.dto.response.RouteObservationBatch;
import com.freelanceops.backend.domain.agentrun.model.AgentRunStatus;
import com.freelanceops.backend.domain.agentrun.entity.AgentRouteCollectionEntity;
import com.freelanceops.backend.domain.agentrun.entity.AgentRouteObservationEntity;
import com.freelanceops.backend.domain.agentrun.entity.AgentRunEntity;
import com.freelanceops.backend.domain.agentrun.repository.AgentRouteCollectionRepository;
import com.freelanceops.backend.domain.agentrun.repository.AgentRouteObservationRepository;
import com.freelanceops.backend.domain.agentrun.repository.AgentRunRepository;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

@Service
public class AgentRouteCollectionQueue {
    private static final Duration LEASE = Duration.ofMinutes(2);
    private static final Set<String> ROUTES = Set.of(
        "DIRECT_TOOL", "SIMPLE_LLM", "REACT_AGENT", "SUPERVISOR", "HUMAN_REQUIRED"
    );
    private static final Set<String> ALLOWED_FIELDS = Set.of(
        "route", "decisionSource", "reasonCodes", "evaluatorProvider", "evaluatorModel", "evaluatorSuggestedRoute",
        "failureCode", "safetyCode", "policyOverrodeRoute", "shadowSuggestedRoute",
        "shadowNeedsFallback", "shadowFallbackReason", "shadowFusedShare", "shadowMargin",
        "shadowLaneAgreement", "shadowLatencyMs", "routingLatencyMs", "routingInputTokens",
        "routingOutputTokens"
    );

    private final AgentRouteCollectionRepository collectionRepository;
    private final AgentRouteObservationRepository observationRepository;
    private final AgentRunRepository runRepository;
    private final AgentRouteReviewPolicy reviewPolicy;

    public AgentRouteCollectionQueue(AgentRouteCollectionRepository collectionRepository,
                                     AgentRouteObservationRepository observationRepository,
                                     AgentRunRepository runRepository,
                                     AgentRouteReviewPolicy reviewPolicy) {
        this.collectionRepository = collectionRepository;
        this.observationRepository = observationRepository;
        this.runRepository = runRepository;
        this.reviewPolicy = reviewPolicy;
    }

    @Transactional
    public Optional<ClaimedCollection> claimNext() {
        Instant now = Instant.now();
        return collectionRepository.findDispatchableForUpdate(now, PageRequest.of(0, 1)).stream()
            .findFirst()
            .map(collection -> {
                collection.claim(now, LEASE);
                return new ClaimedCollection(
                    collection.agentRunId(), collection.cursorEventId(), collection.attempts()
                );
            });
    }

    @Transactional
    public boolean record(ClaimedCollection claim, RouteObservationBatch batch) {
        AgentRouteCollectionEntity collection = collectionRepository.findByRunIdForUpdate(claim.runId())
            .orElse(null);
        if (collection == null) return false;
        validateBatch(claim, batch);
        AgentRunEntity run = runRepository.findById(claim.runId())
            .orElseThrow(() -> new IllegalStateException("route collection references an unknown run"));
        boolean complete = batch.terminal() && !batch.hasMore();
        Duration nextDelay = batch.status() == AgentRunStatus.WAITING_FOR_USER && batch.events().isEmpty()
            ? Duration.ofSeconds(60)
            : Duration.ofSeconds(5);
        if (!collection.record(Instant.now(), batch.nextEventId(), complete, nextDelay, claim.attempt())) return false;
        for (AgentRunEvent event : batch.events()) {
            if (observationRepository.existsByAgentRunIdAndAgentEventId(event.runId(), event.eventId())) continue;
            UUID observationId = UUID.randomUUID();
            Map<String, Object> routeData = sanitize(event.data());
            AgentRouteObservationEntity observation = new AgentRouteObservationEntity(
                observationId, run.workspaceId(), run.projectId(), run.id(), event.eventId(),
                event.occurredAt(), routeData, Instant.now()
            );
            observation.configureReviewTarget(reviewPolicy.reviewTarget(observationId, routeData));
            observationRepository.save(observation);
        }
        return true;
    }

    @Transactional
    public boolean retry(ClaimedCollection claim, Duration delay, String error) {
        return collectionRepository.findByRunIdForUpdate(claim.runId())
            .map(collection -> collection.retry(Instant.now(), delay, error, claim.attempt()))
            .orElse(false);
    }

    static Map<String, Object> sanitize(Map<String, Object> data) {
        Object route = data.get("route");
        if (!(route instanceof String routeName) || !ROUTES.contains(routeName)) {
            throw new IllegalArgumentException("route observation has an invalid route");
        }
        Map<String, Object> sanitized = new LinkedHashMap<>();
        for (String field : ALLOWED_FIELDS) {
            Object value = data.get(field);
            if (value != null) sanitized.put(field, safeValue(field, value));
        }
        sanitized.put("route", routeName);
        return Map.copyOf(sanitized);
    }

    private static Object safeValue(String field, Object value) {
        if (value instanceof String text) {
            if (text.length() > 200) throw new IllegalArgumentException("route signal is too long");
            if ("evaluatorProvider".equals(field) && !Set.of("OPENAI", "GEMINI").contains(text)) {
                throw new IllegalArgumentException("route evaluator provider is invalid");
            }
            if (field.endsWith("Route") && !ROUTES.contains(text)) {
                throw new IllegalArgumentException("route signal has an invalid route");
            }
            return text;
        }
        if (value instanceof Boolean) return value;
        if (value instanceof Number number) return safeNumber(field, number);
        if ("reasonCodes".equals(field) && value instanceof Iterable<?> iterable) {
            List<String> codes = new ArrayList<>();
            for (Object item : iterable) {
                if (!(item instanceof String code) || code.length() > 100 || codes.size() >= 10) {
                    throw new IllegalArgumentException("route reason code is invalid");
                }
                codes.add(code);
            }
            return List.copyOf(codes);
        }
        throw new IllegalArgumentException("route observation field is not allowlisted: " + field);
    }

    private static Object safeNumber(String field, Number number) {
        double value = number.doubleValue();
        if (!Double.isFinite(value) || value < 0) {
            throw new IllegalArgumentException("route numeric signal is invalid");
        }
        if (Set.of("shadowFusedShare", "shadowMargin").contains(field)) {
            if (value > 1) throw new IllegalArgumentException("route share signal must be between zero and one");
            return value;
        }
        if (Set.of("routingInputTokens", "routingOutputTokens").contains(field)) {
            if (value != Math.rint(value) || value > 10_000_000) {
                throw new IllegalArgumentException("route token signal is invalid");
            }
            return number.longValue();
        }
        if (Set.of("shadowLatencyMs", "routingLatencyMs").contains(field)) {
            if (value > 900_000) throw new IllegalArgumentException("route latency signal is invalid");
            return value;
        }
        throw new IllegalArgumentException("route numeric field is not recognized: " + field);
    }

    private static void validateBatch(ClaimedCollection claim, RouteObservationBatch batch) {
        if (!claim.runId().equals(batch.runId())) throw new IllegalArgumentException("route batch run does not match");
        long cursor = claim.cursorEventId();
        for (AgentRunEvent event : batch.events()) {
            if (!claim.runId().equals(event.runId()) || !"route.selected".equals(event.type()) || event.eventId() <= cursor) {
                throw new IllegalArgumentException("route batch event is invalid or non-increasing");
            }
            cursor = event.eventId();
        }
        if (batch.nextEventId() != cursor || batch.hasMore() && batch.events().size() != 100) {
            throw new IllegalArgumentException("route batch cursor contract is invalid");
        }
    }

    public record ClaimedCollection(UUID runId, long cursorEventId, int attempt) { }
}
