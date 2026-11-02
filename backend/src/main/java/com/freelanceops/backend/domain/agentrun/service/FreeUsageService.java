package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest;
import com.freelanceops.backend.domain.agentrun.dto.response.FreeUsageModelRateResponse;
import com.freelanceops.backend.domain.agentrun.dto.response.FreeUsageResponse;
import com.freelanceops.backend.domain.agentrun.dto.response.FreeUsageSettingsResponse;
import com.freelanceops.backend.domain.agentrun.model.AgentRunStatus;
import com.freelanceops.backend.domain.agentrun.model.Provider;
import com.freelanceops.backend.domain.agentrun.repository.JdbcFreeUsageRepository;
import com.freelanceops.backend.domain.agentrun.repository.JdbcFreeUsageRepository.Reservation;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.TemporalAdjusters;
import java.util.List;
import java.util.UUID;

@Service
public class FreeUsageService {
    public static final int MAX_LIMIT = 100000;
    public static final ZoneId TIMEZONE = ZoneId.of("Asia/Seoul");
    public static final String RESET_CONFIRMATION = "RESET_ALL_FREE_USAGE";
    private final JdbcFreeUsageRepository repository;

    public FreeUsageService(JdbcFreeUsageRepository repository) {
        this.repository = repository;
    }

    public record Period(LocalDate start, Instant resetAt) {
        public static Period at(Instant now) {
            LocalDate start =
                    now.atZone(TIMEZONE)
                            .toLocalDate()
                            .with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
            return new Period(start, start.plusWeeks(1).atStartOfDay(TIMEZONE).toInstant());
        }
    }

    /** 실행·발송 대기 명령과 같은 트랜잭션에서 예약한다. 금액 예약은 별도 원장에 기록한다. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void reserve(UUID user, UUID runId, Provider provider, String model) {
        reserveWithSettings(user, runId, provider, model, settings(false));
    }

    /** 시작 요청의 가격이 전송 전에 표시한 가격과 일치해야 한다. 변경된 가격을 자동 적용하지 않는다. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void reserveQuoted(
            UUID user,
            UUID runId,
            Provider provider,
            String model,
            StartAgentRunRequest.CreditQuote quote) {
        FreeUsageSettingsResponse settings = settings(false);
        FreeUsageModelRateResponse rate = requireRate(settings, provider, model);
        if (quote == null || quote.pricingUpdatedAt() == null) {
            throw new CreditQuoteException(
                    HttpStatus.PRECONDITION_REQUIRED,
                    "CREDIT_QUOTE_REQUIRED",
                    "Refresh the weekly credit quote before starting");
        }
        if (rate.credits() != quote.credits()
                || !settings.updatedAt().equals(quote.pricingUpdatedAt())) {
            throw new CreditQuoteException(
                    HttpStatus.CONFLICT,
                    "CREDIT_QUOTE_STALE",
                    "Credit price changed; refresh and confirm the new quote");
        }
        reserveWithSettings(user, runId, provider, model, settings);
    }

    private static FreeUsageModelRateResponse requireRate(
            FreeUsageSettingsResponse settings, Provider provider, String model) {
        return settings.modelRates().stream()
                .filter(
                        rate ->
                                rate.provider() == provider
                                        && rate.model().equals(model)
                                        && rate.enabled())
                .findFirst()
                .orElseThrow(
                        () ->
                                new CreditQuoteException(
                                        HttpStatus.UNPROCESSABLE_CONTENT,
                                        "PLATFORM_MODEL_UNAVAILABLE",
                                        "Selected platform model is unavailable or has no credit price"));
    }

    private void reserveWithSettings(
            UUID user,
            UUID runId,
            Provider provider,
            String model,
            FreeUsageSettingsResponse settings) {
        requireActiveUser(user);
        FreeUsageModelRateResponse rate = requireRate(settings, provider, model);
        Period period = currentPeriod();
        repository.insertWeeklyBucket(user, period.start(), settings.epoch());
        int reserved =
                repository.reserveWeeklyCredits(
                        rate.credits(), user, period.start(), settings.epoch(), settings.limit());
        if (reserved == 0)
            throw new FreeUsageExhaustedException(
                    usage(user, settings, period, false), rate.credits());
        repository.insertWeeklyReservation(
                runId,
                user,
                period.start(),
                settings.epoch(),
                rate.credits(),
                provider.name(),
                model,
                settings.updatedAt());
    }

    /** Agent가 확인한 종료 상태로만 정산한다. 전달 여부가 불명확한 실행은 시간 경과로 반환하지 않는다. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void settleConfirmed(UUID runId, AgentRunStatus status) {
        String target =
                switch (status) {
                    case COMPLETED, PARTIAL -> "CONSUMED";
                    case FAILED, CANCELLED -> "RELEASED";
                    default -> null;
                };
        if (target == null) return;
        var matches = repository.findWeeklyReservation(runId);
        if (matches.isEmpty()) {
            settleLegacy(runId, target);
            return;
        }
        Reservation reservation = matches.getFirst();
        if (!"RESERVED".equals(reservation.status())) return;
        int updated =
                repository.settleWeeklyBucket(
                        reservation.credits(),
                        "CONSUMED".equals(target) ? reservation.credits() : 0,
                        reservation.userId(),
                        reservation.period(),
                        reservation.epoch());
        if (updated != 1)
            throw new IllegalStateException("Weekly credit reservation ledger is inconsistent");
        repository.settleWeeklyReservation(target, runId);
    }

    /** 진행 중인 기존 월간 예약은 주간 크레딧으로 바꾸지 않고 기존 원장에서 정산한다. */
    private void settleLegacy(UUID runId, String target) {
        var matches = repository.findLegacyReservation(runId);
        if (matches.isEmpty() || !"RESERVED".equals(matches.getFirst().status())) return;
        var reservation = matches.getFirst();
        int updated =
                repository.settleLegacyBucket(
                        "CONSUMED".equals(target) ? 1 : 0,
                        reservation.userId(),
                        reservation.period(),
                        reservation.epoch());
        if (updated != 1)
            throw new IllegalStateException("Legacy free usage ledger is inconsistent");
        repository.settleLegacyReservation(target, runId);
    }

    @Transactional
    public FreeUsageResponse current(UUID user) {
        requireActiveUser(user);
        return usage(user, settings(false), currentPeriod(), canManage(user));
    }

    @Transactional
    public FreeUsageSettingsResponse adminSettings(UUID user) {
        requireAdmin(user);
        return settings(false);
    }

    @Transactional
    public FreeUsageSettingsResponse changeLimit(
            UUID actor, int limit, long expectedEpoch, Instant expectedUpdatedAt) {
        requireAdmin(actor);
        if (limit < 0 || limit > MAX_LIMIT || expectedUpdatedAt == null) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "Weekly credit limit must be a whole number from 0 to " + MAX_LIMIT);
        }
        FreeUsageSettingsResponse before = settings(true);
        requireVersion(before, expectedEpoch);
        if (!before.updatedAt().equals(expectedUpdatedAt)) throw changed();
        if (limit == before.limit()) return before;
        repository.updateWeeklyLimit(limit);
        FreeUsageSettingsResponse after = settings(false);
        audit(
                actor,
                "CHANGE_LIMIT",
                "weekly_limit",
                Integer.toString(before.limit()),
                Integer.toString(after.limit()),
                before,
                after);
        return after;
    }

    @Transactional
    public FreeUsageSettingsResponse resetAll(
            UUID actor, String confirmation, long expectedEpoch, Instant expectedUpdatedAt) {
        requireAdmin(actor);
        if (!RESET_CONFIRMATION.equals(confirmation)) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST, "Explicit reset confirmation is required");
        }
        FreeUsageSettingsResponse before = settings(true);
        requireVersion(before, expectedEpoch);
        if (expectedUpdatedAt == null || !before.updatedAt().equals(expectedUpdatedAt))
            throw changed();
        if (before.epoch() == Long.MAX_VALUE)
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Reset generation exhausted");
        repository.incrementEpoch();
        FreeUsageSettingsResponse after = settings(false);
        audit(
                actor,
                "RESET_ALL",
                "epoch",
                Long.toString(before.epoch()),
                Long.toString(after.epoch()),
                before,
                after);
        return after;
    }

    private Period currentPeriod() {
        // 모든 인스턴스가 예약·조회 시 같은 기준을 쓰도록 데이터베이스 시각을 사용한다.
        Instant now = repository.databaseTime();
        if (now == null) throw new IllegalStateException("Database clock unavailable");
        return Period.at(now);
    }

    private FreeUsageSettingsResponse settings(boolean write) {
        var base = repository.findSettings(write, MAX_LIMIT);
        if (base == null) throw new IllegalStateException("Weekly credit settings unavailable");
        List<FreeUsageModelRateResponse> rates = repository.listModelRates();
        return new FreeUsageSettingsResponse(
                base.limit(),
                MAX_LIMIT,
                base.epoch(),
                base.updatedAt(),
                base.lastResetAt(),
                rates,
                "CREDITS",
                "WEEKLY");
    }

    private FreeUsageResponse usage(
            UUID user, FreeUsageSettingsResponse settings, Period period, boolean canManage) {
        List<int[]> buckets = repository.findBucket(user, period.start(), settings.epoch());
        int used = buckets.isEmpty() ? 0 : buckets.getFirst()[0];
        int reserved = buckets.isEmpty() ? 0 : buckets.getFirst()[1];
        return new FreeUsageResponse(
                settings.limit(),
                used,
                reserved,
                Math.max(0, settings.limit() - used - reserved),
                period.resetAt(),
                period.start().toString(),
                TIMEZONE.getId(),
                settings.epoch(),
                canManage,
                "CREDITS",
                "WEEKLY",
                settings.modelRates(),
                settings.updatedAt());
    }

    @Transactional
    public FreeUsageSettingsResponse changeModelRate(
            UUID actor,
            Provider provider,
            String model,
            int credits,
            boolean enabled,
            long expectedEpoch,
            Instant expectedUpdatedAt) {
        requireAdmin(actor);
        if (credits < 1
                || credits > MAX_LIMIT
                || provider == null
                || model == null
                || expectedUpdatedAt == null) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "Model credits must be a whole number from 1 to " + MAX_LIMIT);
        }
        FreeUsageSettingsResponse before = settings(true);
        requireVersion(before, expectedEpoch);
        if (!before.updatedAt().equals(expectedUpdatedAt)) throw changed();
        FreeUsageModelRateResponse old =
                before.modelRates().stream()
                        .filter(rate -> rate.provider() == provider && rate.model().equals(model))
                        .findFirst()
                        .orElseThrow(
                                () ->
                                        new ResponseStatusException(
                                                HttpStatus.BAD_REQUEST,
                                                "Unsupported platform model"));
        if (old.credits() == credits && old.enabled() == enabled) return before;
        repository.updateModelRate(credits, enabled, provider.name(), model);
        repository.touchSettings();
        FreeUsageSettingsResponse after = settings(false);
        audit(
                actor,
                "CHANGE_MODEL",
                provider.name() + ":" + model,
                old.credits() + ":" + old.enabled(),
                credits + ":" + enabled,
                before,
                after);
        return after;
    }

    private void requireActiveUser(UUID user) {
        Boolean active = repository.isActiveUser(user);
        if (!Boolean.TRUE.equals(active)) throw new ResponseStatusException(HttpStatus.FORBIDDEN);
    }

    public boolean canManage(UUID user) {
        return Boolean.TRUE.equals(repository.canManage(user));
    }

    private void requireAdmin(UUID user) {
        // 변경이 끝날 때까지 권한과 계정 행을 잠가 권한 철회·비활성화와의 경합을 막는다.
        var grants = repository.findAdminGrant(user);
        if (grants.isEmpty())
            throw new ResponseStatusException(
                    HttpStatus.FORBIDDEN, "Platform administrator capability required");
    }

    private void audit(
            UUID actor,
            String action,
            String target,
            String previousValue,
            String newValue,
            FreeUsageSettingsResponse before,
            FreeUsageSettingsResponse after) {
        repository.insertAudit(
                UUID.randomUUID(),
                actor,
                action,
                target,
                previousValue,
                newValue,
                before.epoch(),
                after.epoch());
    }

    private static void requireVersion(FreeUsageSettingsResponse settings, long expectedEpoch) {
        if (settings.epoch() != expectedEpoch) throw changed();
    }

    private static ResponseStatusException changed() {
        return new ResponseStatusException(
                HttpStatus.CONFLICT, "Free usage settings changed; reload before trying again");
    }
}
