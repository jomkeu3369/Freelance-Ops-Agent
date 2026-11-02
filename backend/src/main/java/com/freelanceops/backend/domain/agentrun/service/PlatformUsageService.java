package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView;
import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView.ExternalToolCallUsage;
import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView.ProviderCallUsage;
import com.freelanceops.backend.domain.agentrun.dto.response.PlatformUsageHistoryResponse;
import com.freelanceops.backend.domain.agentrun.dto.response.PlatformUsageModelResponse;
import com.freelanceops.backend.domain.agentrun.dto.response.PlatformUsageResponse;
import com.freelanceops.backend.domain.agentrun.entity.AgentRunEntity;
import com.freelanceops.backend.domain.agentrun.model.AgentRunStatus;
import com.freelanceops.backend.domain.agentrun.model.Provider;
import com.freelanceops.backend.domain.agentrun.repository.JdbcPlatformUsageRepository;
import com.freelanceops.backend.domain.agentrun.repository.JdbcPlatformUsageRepository.Hold;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import tools.jackson.databind.ObjectMapper;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.LocalDate;
import java.util.*;

/** 컨트롤러에서 권한을 확인한 사용자 식별자를 받는다. 상태명 변경이나 크레딧 초기화·삭제만으로 금액을 반환하지 않는다. */
@Service
public class PlatformUsageService {
    private static final BigDecimal ZERO = BigDecimal.ZERO.setScale(8);
    private static final UUID GLOBAL = new UUID(0, 0);
    private static final Set<AgentRunStatus> TERMINAL =
            EnumSet.of(
                    AgentRunStatus.COMPLETED,
                    AgentRunStatus.PARTIAL,
                    AgentRunStatus.FAILED,
                    AgentRunStatus.CANCELLED);
    private final JdbcPlatformUsageRepository repository;
    private final ObjectMapper mapper;
    private final boolean enabled;

    public PlatformUsageService(
            JdbcPlatformUsageRepository repository,
            ObjectMapper mapper,
            @Value("${platform.ai.spend.enabled:false}") boolean enabled) {
        this.repository = repository;
        this.mapper = mapper;
        this.enabled = enabled;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void synchronize(AgentRunEntity run, AgentRunView view) {
        var usage = view.usage();
        if (usage == null || usage.platformReservationId() == null) return;
        if (!run.id().equals(usage.platformReservationId()) || !run.id().equals(view.runId()))
            throw new IllegalArgumentException("Usage reservation identity mismatch");
        synchronizeOperation(
                run.id(),
                run.initiatedBy(),
                run.provider(),
                run.model(),
                run.credentialId(),
                usage,
                view.updatedAt(),
                TERMINAL.contains(view.status()));
    }

    /** 펫 생성도 분석 실행과 같은 금액 예약·사용량 정산을 사용한다. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void synchronizeOperation(
            UUID operationId,
            UUID user,
            Provider provider,
            String model,
            UUID credentialId,
            AgentRunView.AgentRunUsage usage,
            Instant observedAt,
            boolean terminal) {
        if (usage == null || !operationId.equals(usage.platformReservationId()))
            throw new IllegalArgumentException("Usage reservation identity mismatch");
        // 예약과 같은 순서로 잠가 반환 처리와 새 예약을 직렬화한다.
        repository.lockSettings();
        var rows = repository.findSettlement(operationId);
        if (rows.isEmpty()) throw new IllegalArgumentException("Usage reservation is missing");
        Hold hold = rows.getFirst();
        if (!hold.user().equals(user) || !hold.version().equals(usage.tariffVersion()))
            throw new IllegalArgumentException("Usage tariff or account mismatch");
        if (!usage.externalToolCalls().isEmpty()
                && !PlatformSpendTariff.VERSION.equals(hold.version()))
            throw new IllegalArgumentException(
                    "Reservation does not authorize external tool spending");
        if (hold.observed() != null && observedAt.isBefore(hold.observed())) return;
        if (usage.providerCalls().size() != usage.modelCalls())
            return; // 사용량 정보가 불완전하면 예약 금액을 유지한다.
        var previous = attempts(operationId);
        Map<UUID, ProviderCallUsage> merged = new LinkedHashMap<>();
        previous.forEach(call -> merged.put(call.callId(), call));
        for (var call : usage.providerCalls()) {
            if ("BYOK".equals(call.fundingSource())
                    && (credentialId == null
                            || call.provider() != provider
                            || !call.model().equals(model)))
                throw new IllegalArgumentException("Personal usage binding mismatch");
            var prior = merged.get(call.callId());
            if (prior != null) {
                if (prior.provider() != call.provider()
                        || !prior.model().equals(call.model())
                        || !prior.operation().equals(call.operation())
                        || !prior.fundingSource().equals(call.fundingSource())
                        || prior.reservedCostUsd().compareTo(call.reservedCostUsd()) != 0)
                    throw new IllegalArgumentException("Attempt identity changed");
                if (prior.usageKnown()) {
                    if (call.usageKnown() && !sameUsage(prior, call))
                        throw new IllegalArgumentException("Settled attempt changed");
                    continue; // 호출 전 사용량이 뒤늦게 도착해도 완료된 정산을 되돌리지 않는다.
                }
            } else if (hold.closed()) {
                throw new IllegalArgumentException("Closed execution reported a new attempt");
            }
            merged.put(call.callId(), call);
            int changed =
                    repository.upsertProviderAttempt(
                            call.callId(), operationId, mapper.writeValueAsString(call));
            if (changed != 1) throw new IllegalArgumentException("Attempt belongs to another run");
        }
        BigDecimal settled = ZERO, unknown = ZERO;
        boolean priceable = !usage.unpricedExposure();
        for (var call : merged.values()) {
            if ("BYOK".equals(call.fundingSource())) continue;
            BigDecimal cost =
                    PlatformSpendTariff.conservativeCost(List.of(call), 1, hold.version());
            if (cost == null) {
                priceable = false;
                continue;
            }
            if (call.usageKnown()) settled = settled.add(cost);
            else unknown = unknown.add(cost);
        }
        var tools = synchronizeTools(operationId, usage.externalToolCalls(), hold.closed());
        for (var call : tools) {
            if (call.usageKnown()) settled = settled.add(ExternalToolSpend.BASIC_SEARCH_USD);
            else unknown = unknown.add(ExternalToolSpend.BASIC_SEARCH_USD);
        }
        boolean closed = hold.closed() || (usage.executionClosed() && terminal);
        // 기존 형식의 예약과 누락되거나 금액을 산정할 수 없는 보고는 예약 전액을 유지한다. 확인된 사용 금액은 별도로 표시한다.
        BigDecimal exposure = settled.add(unknown);
        if (!closed || !priceable || PlatformSpendTariff.LEGACY_VERSION.equals(hold.version()))
            exposure = exposure.max(hold.cap());
        BigDecimal reserved = exposure.subtract(settled).max(ZERO);
        BigDecimal delta = exposure.subtract(hold.settled().add(hold.reserved()));
        adjust("GLOBAL_DAY", GLOBAL, hold.day(), delta);
        adjust("GLOBAL_WEEK", GLOBAL, hold.week(), delta);
        adjust("ACCOUNT_WEEK", hold.user(), hold.week(), delta);
        repository.updateSettlement(settled, reserved, closed, observedAt, operationId);
    }

    private static boolean sameUsage(ProviderCallUsage a, ProviderCallUsage b) {
        return a.inputTokens() == b.inputTokens()
                && a.outputTokens() == b.outputTokens()
                && a.cachedReadTokens() == b.cachedReadTokens()
                && a.cacheWriteTokens() == b.cacheWriteTokens();
    }

    private void adjust(String scope, UUID subject, LocalDate period, BigDecimal delta) {
        if (delta.signum() == 0) return;
        if (repository.adjustBucket(delta, scope, subject, period) != 1)
            throw new IllegalStateException("Monetary bucket is inconsistent");
    }

    private List<ProviderCallUsage> attempts(UUID run) {
        return repository.listProviderAttempts(run);
    }

    private List<ExternalToolCallUsage> synchronizeTools(
            UUID run, List<ExternalToolCallUsage> incoming, boolean closed) {
        Map<UUID, ExternalToolCallUsage> calls = new LinkedHashMap<>();
        repository.listExternalAttempts(run).forEach(call -> calls.put(call.callId(), call));
        for (var call : incoming) {
            ExternalToolSpend.validate(call);
            var prior = calls.get(call.callId());
            if (prior != null) {
                if (!prior.provider().equals(call.provider())
                        || !prior.operation().equals(call.operation())
                        || !prior.tariffVersion().equals(call.tariffVersion())
                        || prior.credits() != call.credits()
                        || prior.reservedCostUsd().compareTo(call.reservedCostUsd()) != 0)
                    throw new IllegalArgumentException("External attempt identity changed");
                if (prior.usageKnown()) continue;
            } else if (closed)
                throw new IllegalArgumentException(
                        "Closed execution reported a new external attempt");
            int changed =
                    repository.upsertExternalAttempt(
                            call.callId(), run, mapper.writeValueAsString(call));
            if (changed != 1)
                throw new IllegalArgumentException("External attempt belongs to another execution");
            calls.put(call.callId(), call);
        }
        return List.copyOf(calls.values());
    }

    @Transactional
    public PlatformUsageResponse snapshot(UUID userId) {
        Objects.requireNonNull(userId);
        Instant now = repository.databaseTime();
        var period = FreeUsageService.Period.at(now);
        var settings = repository.findBudgetLimits();
        BigDecimal limit = settings.getFirst();
        var totals = repository.findWeeklyTotals(userId, period.start());
        BigDecimal remaining = limit.subtract(totals.get(0)).subtract(totals.get(1)).max(ZERO);
        BigDecimal globalRemaining =
                available(
                                "GLOBAL_DAY",
                                GLOBAL,
                                PlatformSpendService.Period.at(now).day(),
                                settings.get(1))
                        .min(available("GLOBAL_WEEK", GLOBAL, period.start(), settings.get(2)));
        List<PlatformUsageModelResponse> models =
                repository.listModelCaps().stream()
                        .map(
                                cap -> {
                                    String id = cap.model();

                                    boolean active = cap.enabled();

                                    String reason =
                                            !enabled
                                                    ? "SPENDING_DISABLED"
                                                    : (!active || cap.maxRunUsd().signum() <= 0)
                                                            ? "MODEL_DISABLED"
                                                            : (id.equals("gpt-5.6-sol")
                                                                            && !now.isBefore(
                                                                                    PlatformSpendTariff
                                                                                            .PROMOTION_REVIEW_AT))
                                                                    ? "TARIFF_REVIEW_REQUIRED"
                                                                    : remaining.signum() <= 0
                                                                            ? "ACCOUNT_BUDGET_EXHAUSTED"
                                                                            : globalRemaining
                                                                                                    .signum()
                                                                                            <= 0
                                                                                    ? "GLOBAL_BUDGET_EXHAUSTED"
                                                                                    : null;

                                    var efforts =
                                            List.of("gpt-6.1-sol", "gpt-6-astra").contains(id)
                                                    ? List.of("LOW", "MEDIUM", "HIGH")
                                                    : List.of("NONE", "LOW", "MEDIUM", "HIGH");

                                    return new PlatformUsageModelResponse(
                                            "OPENAI",
                                            id,
                                            true,
                                            active,
                                            efforts,
                                            cap.maxRunUsd(),
                                            reason == null,
                                            reason,
                                            false);
                                })
                        .toList();
        return new PlatformUsageResponse(
                "USD",
                limit,
                totals.get(0),
                totals.get(1),
                remaining,
                percent(remaining, limit),
                percent(totals.get(1), limit),
                period.start(),
                period.resetAt(),
                "Asia/Seoul",
                enabled,
                models);
    }

    private BigDecimal available(String scope, UUID subject, LocalDate period, BigDecimal limit) {
        var held = repository.findBucket(scope, subject, period);
        return limit.subtract(held.isEmpty() ? ZERO : held.getFirst()).max(ZERO);
    }

    static BigDecimal percent(BigDecimal amount, BigDecimal limit) {
        return limit.signum() == 0
                ? BigDecimal.ZERO
                : amount.multiply(BigDecimal.valueOf(100))
                        .divide(limit, 4, RoundingMode.DOWN)
                        .min(BigDecimal.valueOf(100))
                        .max(BigDecimal.ZERO);
    }

    private List<ProviderCallUsage> personalAttempts(UUID scope, String model) {
        // 예약 상한을 계산한 값이며 실제 청구액이나 확정 사용량을 뜻하지 않는다.
        return repository.listPersonalAttempts(scope, model);
    }

    @Transactional(readOnly = true)
    public PlatformUsageHistoryResponse history(UUID userId, String cursor, int limit) {
        Objects.requireNonNull(userId);
        if (limit < 1 || limit > 100)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Limit must be 1..100");
        Instant before = Instant.parse("9999-12-31T00:00:00Z");
        UUID beforeId = new UUID(-1, -1);
        if (cursor != null) {
            try {
                String[] decoded =
                        new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8)
                                .split("\\|", -1);
                before = Instant.parse(decoded[0]);
                beforeId = UUID.fromString(decoded[1]);
                if (decoded.length != 2) throw new IllegalArgumentException();
            } catch (RuntimeException error) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid usage cursor");
            }
        }
        var items = repository.listHistory(userId, userId.toString(), before, beforeId, limit + 1);
        boolean more = items.size() > limit;
        items = List.copyOf(items.subList(0, Math.min(items.size(), limit)));
        String next = null;
        if (more) {
            var last = items.getLast();
            next =
                    Base64.getUrlEncoder()
                            .withoutPadding()
                            .encodeToString(
                                    (last.startedAt() + "|" + last.runId())
                                            .getBytes(StandardCharsets.UTF_8));
        }
        return new PlatformUsageHistoryResponse(items, next);
    }
}
