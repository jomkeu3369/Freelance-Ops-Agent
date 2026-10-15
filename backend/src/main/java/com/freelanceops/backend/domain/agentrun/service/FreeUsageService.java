package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest;
import com.freelanceops.backend.domain.agentrun.model.AgentRunStatus;
import com.freelanceops.backend.domain.agentrun.model.Provider;

import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.sql.Date;
import java.sql.Timestamp;
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
    private final JdbcTemplate jdbc;

    public FreeUsageService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
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

    public record ModelRate(Provider provider, String model, int credits, boolean enabled) {}

    public record Usage(
            int limit,
            int used,
            int reserved,
            int remaining,
            Instant resetAt,
            String period,
            String timezone,
            long epoch,
            boolean canManage,
            String unit,
            String periodType,
            List<ModelRate> modelRates,
            Instant pricingUpdatedAt) {
        public Usage(
                int limit,
                int used,
                int reserved,
                int remaining,
                Instant resetAt,
                String period,
                String timezone,
                long epoch,
                boolean canManage) {
            this(
                    limit, used, reserved, remaining, resetAt, period, timezone, epoch, canManage,
                    "CREDITS", "WEEKLY", List.of(), null);
        }
    }

    public record Settings(
            int limit,
            int maxLimit,
            long epoch,
            Instant updatedAt,
            Instant lastResetAt,
            List<ModelRate> modelRates,
            String unit,
            String periodType) {
        public Settings(
                int limit, int maxLimit, long epoch, Instant updatedAt, Instant lastResetAt) {
            this(limit, maxLimit, epoch, updatedAt, lastResetAt, List.of(), "CREDITS", "WEEKLY");
        }
    }

    private record Reservation(
            UUID userId, LocalDate period, long epoch, String status, int credits) {}

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
        Settings settings = settings(false);
        ModelRate rate = requireRate(settings, provider, model);
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

    private static ModelRate requireRate(Settings settings, Provider provider, String model) {
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
            UUID user, UUID runId, Provider provider, String model, Settings settings) {
        requireActiveUser(user);
        ModelRate rate = requireRate(settings, provider, model);
        Period period = currentPeriod();
        jdbc.update(
                "INSERT INTO app.weekly_credit_bucket(user_id, period, epoch) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
                user,
                Date.valueOf(period.start()),
                settings.epoch());
        int reserved =
                jdbc.update(
                        """
            UPDATE app.weekly_credit_bucket SET reserved = reserved + ?
            WHERE user_id = ? AND period = ? AND epoch = ? AND used + reserved <= ? - ?
            """,
                        rate.credits(),
                        user,
                        Date.valueOf(period.start()),
                        settings.epoch(),
                        settings.limit(),
                        rate.credits());
        if (reserved == 0)
            throw new FreeUsageExhaustedException(
                    usage(user, settings, period, false), rate.credits());
        jdbc.update(
                """
            INSERT INTO app.weekly_credit_reservation
                (run_id, user_id, period, epoch, status, credits, provider, model, rate_version)
            VALUES (?, ?, ?, ?, 'RESERVED', ?, ?, ?, ?)
            """,
                runId,
                user,
                Date.valueOf(period.start()),
                settings.epoch(),
                rate.credits(),
                provider.name(),
                model,
                Timestamp.from(settings.updatedAt()));
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
        var matches =
                jdbc.query(
                        """
            SELECT user_id, period, epoch, status, credits FROM app.weekly_credit_reservation WHERE run_id = ? FOR UPDATE
            """,
                        (row, n) ->
                                new Reservation(
                                        row.getObject(1, UUID.class),
                                        row.getDate(2).toLocalDate(),
                                        row.getLong(3),
                                        row.getString(4),
                                        row.getInt(5)),
                        runId);
        if (matches.isEmpty()) {
            settleLegacy(runId, target);
            return;
        }
        Reservation reservation = matches.getFirst();
        if (!"RESERVED".equals(reservation.status())) return;
        int updated =
                jdbc.update(
                        """
            UPDATE app.weekly_credit_bucket SET reserved = reserved - ?, used = used + ?
            WHERE user_id = ? AND period = ? AND epoch = ? AND reserved >= ?
            """,
                        reservation.credits(),
                        "CONSUMED".equals(target) ? reservation.credits() : 0,
                        reservation.userId(),
                        Date.valueOf(reservation.period()),
                        reservation.epoch(),
                        reservation.credits());
        if (updated != 1)
            throw new IllegalStateException("Weekly credit reservation ledger is inconsistent");
        jdbc.update(
                "UPDATE app.weekly_credit_reservation SET status = ?, settled_at = CURRENT_TIMESTAMP WHERE run_id = ?",
                target,
                runId);
    }

    /** 진행 중인 기존 월간 예약은 주간 크레딧으로 바꾸지 않고 기존 원장에서 정산한다. */
    private void settleLegacy(UUID runId, String target) {
        var matches =
                jdbc.query(
                        """
            SELECT user_id, period, epoch, status FROM app.free_usage_reservation WHERE run_id = ? FOR UPDATE
            """,
                        (row, n) ->
                                new Reservation(
                                        row.getObject(1, UUID.class),
                                        row.getDate(2).toLocalDate(),
                                        row.getLong(3),
                                        row.getString(4),
                                        1),
                        runId);
        if (matches.isEmpty() || !"RESERVED".equals(matches.getFirst().status())) return;
        var reservation = matches.getFirst();
        int updated =
                jdbc.update(
                        """
            UPDATE app.free_usage_bucket SET reserved = reserved - 1, used = used + ?
            WHERE user_id = ? AND period = ? AND epoch = ? AND reserved > 0
            """,
                        "CONSUMED".equals(target) ? 1 : 0,
                        reservation.userId(),
                        Date.valueOf(reservation.period()),
                        reservation.epoch());
        if (updated != 1)
            throw new IllegalStateException("Legacy free usage ledger is inconsistent");
        jdbc.update(
                "UPDATE app.free_usage_reservation SET status = ?, settled_at = CURRENT_TIMESTAMP WHERE run_id = ?",
                target,
                runId);
    }

    @Transactional
    public Usage current(UUID user) {
        requireActiveUser(user);
        return usage(user, settings(false), currentPeriod(), canManage(user));
    }

    @Transactional
    public Settings adminSettings(UUID user) {
        requireAdmin(user);
        return settings(false);
    }

    @Transactional
    public Settings changeLimit(
            UUID actor, int limit, long expectedEpoch, Instant expectedUpdatedAt) {
        requireAdmin(actor);
        if (limit < 0 || limit > MAX_LIMIT || expectedUpdatedAt == null) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "Weekly credit limit must be a whole number from 0 to " + MAX_LIMIT);
        }
        Settings before = settings(true);
        requireVersion(before, expectedEpoch);
        if (!before.updatedAt().equals(expectedUpdatedAt)) throw changed();
        if (limit == before.limit()) return before;
        jdbc.update(
                "UPDATE app.weekly_credit_settings SET weekly_limit = ?, updated_at = GREATEST(clock_timestamp(), updated_at + INTERVAL '1 microsecond') WHERE id = 1",
                limit);
        Settings after = settings(false);
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
    public Settings resetAll(
            UUID actor, String confirmation, long expectedEpoch, Instant expectedUpdatedAt) {
        requireAdmin(actor);
        if (!RESET_CONFIRMATION.equals(confirmation)) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST, "Explicit reset confirmation is required");
        }
        Settings before = settings(true);
        requireVersion(before, expectedEpoch);
        if (expectedUpdatedAt == null || !before.updatedAt().equals(expectedUpdatedAt))
            throw changed();
        if (before.epoch() == Long.MAX_VALUE)
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Reset generation exhausted");
        jdbc.update(
                """
            UPDATE app.weekly_credit_settings SET epoch = epoch + 1, last_reset_at = clock_timestamp(),
            updated_at = GREATEST(clock_timestamp(), updated_at + INTERVAL '1 microsecond') WHERE id = 1
            """);
        Settings after = settings(false);
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
        Timestamp now = jdbc.queryForObject("SELECT clock_timestamp()", Timestamp.class);
        if (now == null) throw new IllegalStateException("Database clock unavailable");
        return Period.at(now.toInstant());
    }

    private Settings settings(boolean write) {
        var base =
                jdbc.queryForObject(
                        "SELECT weekly_limit, epoch, updated_at, last_reset_at FROM app.weekly_credit_settings WHERE id = 1 "
                                + (write ? "FOR UPDATE" : "FOR SHARE"),
                        (row, n) ->
                                new Settings(
                                        row.getInt(1),
                                        MAX_LIMIT,
                                        row.getLong(2),
                                        row.getTimestamp(3).toInstant(),
                                        row.getTimestamp(4) == null
                                                ? null
                                                : row.getTimestamp(4).toInstant()));
        if (base == null) throw new IllegalStateException("Weekly credit settings unavailable");
        List<ModelRate> rates =
                jdbc.query(
                        "SELECT provider, model, credits, enabled FROM app.weekly_credit_model_rate ORDER BY credits, model",
                        (row, n) ->
                                new ModelRate(
                                        Provider.valueOf(row.getString(1)),
                                        row.getString(2),
                                        row.getInt(3),
                                        row.getBoolean(4)));
        return new Settings(
                base.limit(),
                MAX_LIMIT,
                base.epoch(),
                base.updatedAt(),
                base.lastResetAt(),
                rates,
                "CREDITS",
                "WEEKLY");
    }

    private Usage usage(UUID user, Settings settings, Period period, boolean canManage) {
        List<int[]> buckets =
                jdbc.query(
                        "SELECT used, reserved FROM app.weekly_credit_bucket WHERE user_id = ? AND period = ? AND epoch = ?",
                        (row, n) -> new int[] {row.getInt(1), row.getInt(2)},
                        user,
                        Date.valueOf(period.start()),
                        settings.epoch());
        int used = buckets.isEmpty() ? 0 : buckets.getFirst()[0];
        int reserved = buckets.isEmpty() ? 0 : buckets.getFirst()[1];
        return new Usage(
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
    public Settings changeModelRate(
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
        Settings before = settings(true);
        requireVersion(before, expectedEpoch);
        if (!before.updatedAt().equals(expectedUpdatedAt)) throw changed();
        ModelRate old =
                before.modelRates().stream()
                        .filter(rate -> rate.provider() == provider && rate.model().equals(model))
                        .findFirst()
                        .orElseThrow(
                                () ->
                                        new ResponseStatusException(
                                                HttpStatus.BAD_REQUEST,
                                                "Unsupported platform model"));
        if (old.credits() == credits && old.enabled() == enabled) return before;
        jdbc.update(
                "UPDATE app.weekly_credit_model_rate SET credits = ?, enabled = ? WHERE provider = ? AND model = ?",
                credits,
                enabled,
                provider.name(),
                model);
        jdbc.update(
                "UPDATE app.weekly_credit_settings SET updated_at = GREATEST(clock_timestamp(), updated_at + INTERVAL '1 microsecond') WHERE id = 1");
        Settings after = settings(false);
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
        Boolean active =
                jdbc.queryForObject(
                        "SELECT EXISTS(SELECT 1 FROM app.user_account WHERE id = ? AND status = 'ACTIVE')",
                        Boolean.class,
                        user);
        if (!Boolean.TRUE.equals(active)) throw new ResponseStatusException(HttpStatus.FORBIDDEN);
    }

    public boolean canManage(UUID user) {
        return Boolean.TRUE.equals(
                jdbc.queryForObject(
                        """
            SELECT EXISTS(SELECT 1 FROM app.platform_admin_grant grant_row
            JOIN app.user_account account ON account.id = grant_row.user_id AND account.status = 'ACTIVE'
            WHERE grant_row.user_id = ? AND grant_row.capability = 'FREE_USAGE_ADMIN' AND grant_row.revoked_at IS NULL)
            """,
                        Boolean.class,
                        user));
    }

    private void requireAdmin(UUID user) {
        // 변경이 끝날 때까지 권한과 계정 행을 잠가 권한 철회·비활성화와의 경합을 막는다.
        var grants =
                jdbc.query(
                        """
            SELECT grant_row.user_id FROM app.platform_admin_grant grant_row
            JOIN app.user_account account ON account.id = grant_row.user_id AND account.status = 'ACTIVE'
            WHERE grant_row.user_id = ? AND grant_row.capability = 'FREE_USAGE_ADMIN' AND grant_row.revoked_at IS NULL
            FOR SHARE OF grant_row, account
            """,
                        (row, n) -> row.getObject(1, UUID.class),
                        user);
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
            Settings before,
            Settings after) {
        jdbc.update(
                """
            INSERT INTO app.weekly_credit_admin_audit
            (id, actor_user_id, action, target, previous_value, new_value, previous_epoch, new_epoch) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
                UUID.randomUUID(),
                actor,
                action,
                target,
                previousValue,
                newValue,
                before.epoch(),
                after.epoch());
    }

    private static void requireVersion(Settings settings, long expectedEpoch) {
        if (settings.epoch() != expectedEpoch) throw changed();
    }

    private static ResponseStatusException changed() {
        return new ResponseStatusException(
                HttpStatus.CONFLICT, "Free usage settings changed; reload before trying again");
    }
}
