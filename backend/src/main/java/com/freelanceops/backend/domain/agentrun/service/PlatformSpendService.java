package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.client.dto.request.InternalAgentRunRequest.PlatformBudget;
import com.freelanceops.backend.domain.agentrun.client.dto.request.InternalAgentRunRequest.PlatformCompletionEnvelope;
import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest.RunBudget;
import org.springframework.beans.factory.annotation.Autowired;
import tools.jackson.databind.json.JsonMapper;
import java.util.Arrays;
import java.util.ArrayList;
import java.util.List;
import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest.ModelSelection;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.sql.Date;
import java.sql.Timestamp;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.TemporalAdjusters;
import java.util.UUID;

/** Monetary admission independent of historical product credits.
 * V2 unused exposure is released only after the worker closes its ledger.
 * Unknown usage and legacy reservations remain held, including after deletion/reset.
 */
@Service
public class PlatformSpendService {
    public static final String TARIFF_VERSION = PlatformSpendTariff.VERSION;
    static final ZoneId TIMEZONE = ZoneId.of("Asia/Seoul");
    private static final UUID GLOBAL = new UUID(0L, 0L);
    private final JdbcTemplate jdbc;
    private final boolean enabled;
    private final boolean completionEnabled;
    private static final JsonMapper MAPPER = JsonMapper.builder().findAndAddModules().build();

    public PlatformSpendService(JdbcTemplate jdbc, boolean enabled) {
        this(jdbc, enabled, false);
    }

    @Autowired
    public PlatformSpendService(JdbcTemplate jdbc, @Value("${platform.ai.spend.enabled:false}") boolean enabled,
            @Value("${platform.ai.spend.completion-enabled:false}") boolean completionEnabled) {
        this.jdbc = jdbc;
        this.enabled = enabled;
        this.completionEnabled = completionEnabled;
    }

    /** Must participate in the same transaction as user credits, run and dispatch outbox. */
    @Transactional(propagation = Propagation.MANDATORY)
    public PlatformBudget reserve(UUID userId, UUID runId, ModelSelection selection) {
        return reserve(userId, runId, selection, null);
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public PlatformBudget reserve(UUID userId, UUID runId, ModelSelection selection, RunBudget runBudget) {
        if (!enabled) throw new PlatformSpendUnavailableException();
        if (userId == null || runId == null || selection == null) throw new IllegalArgumentException("Admission identity is required");
        PlatformSpendTariff.validateSelection(selection);
        if (selection.credentialId() != null) throw new IllegalArgumentException("Personal funding must not reserve platform spend");
        // One DB-owned settings row serializes admissions across instances, and prevents differing
        // application environment values from creating different monetary limits for the same account.
        Settings settings = jdbc.queryForObject("""
            SELECT account_week_usd, global_day_usd, global_week_usd, global_month_soft_usd,
                   global_month_hard_usd, completion_policy_revision, completion_router_models, completion_required
            FROM app.platform_spend_settings WHERE id = 1 FOR UPDATE
            """, (row, n) -> new Settings(row.getBigDecimal(1), row.getBigDecimal(2), row.getBigDecimal(3),
                row.getBigDecimal(4), row.getBigDecimal(5), row.getLong(6),
                Arrays.asList((String[]) row.getArray(7).getArray()), row.getBoolean(8)));
        if (settings == null) throw new IllegalStateException("Platform spending settings unavailable");
        var existing = jdbc.query("""
            SELECT r.user_id, r.provider, r.model, r.max_cost_usd, r.tariff_version, r.valid_until, c.payload::text
            FROM app.platform_spend_reservation r LEFT JOIN app.platform_completion_reservation c USING(run_id)
            WHERE r.run_id = ?
            """, (row, n) -> new Reservation(row.getObject(1, UUID.class), row.getString(2), row.getString(3),
                new PlatformBudget(runId, row.getBigDecimal(4), row.getString(5), row.getTimestamp(6).toInstant(),
                    row.getString(7) == null ? null : MAPPER.readValue(row.getString(7), PlatformCompletionEnvelope.class))), runId);
        if (!existing.isEmpty()) {
            Reservation previous = existing.getFirst();
            if (!previous.userId().equals(userId) || !previous.provider().equals(selection.provider().name())
                || !previous.model().equals(selection.model())
                || (previous.budget().completion() != null && !previous.budget().completion().budget().equals(runBudget))) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "Run monetary reservation identity does not match");
            }
            return previous.budget();
        }
        Timestamp now = jdbc.queryForObject("SELECT clock_timestamp()", Timestamp.class);
        if (now == null) throw new IllegalStateException("Database clock unavailable");
        Period period = Period.at(now.toInstant());
        if (selection.credentialId() == null) PlatformSpendTariff.requireCurrentPrice(selection.model(), now.toInstant());
        var caps = jdbc.query("""
            SELECT max_run_usd FROM app.platform_spend_model_cap WHERE provider = ? AND model = ? AND enabled FOR SHARE
            """, (row, n) -> row.getBigDecimal(1), selection.provider().name(), selection.model());
        if (caps.isEmpty()) throw new PlatformSpendUnavailableException();
        PlatformCompletionEnvelope completion = null;
        BigDecimal amount = caps.getFirst();
        PlatformSpendMonthLedger.refresh(jdbc, period.month());
        if (settings.completionRequired() && !completionEnabled) throw new PlatformSpendUnavailableException();
        if (settings.completionRequired()) {
            List<String> allowedModels = new ArrayList<>(settings.routerModels());
            allowedModels.add(selection.model());
            allowedModels = allowedModels.stream().distinct().sorted().toList();
            for (String model : allowedModels) PlatformSpendTariff.requireCurrentPrice(model, now.toInstant());
            amount = PlatformSpendTariff.fullReservation(allowedModels, runBudget, TARIFF_VERSION);
            if (amount.compareTo(caps.getFirst()) > 0 || amount.compareTo(new BigDecimal("100")) > 0)
                throw new PlatformSpendExhaustedException("MODEL_FULL_RESERVATION");
            String unavailable = PlatformSpendMonthLedger.unavailable(
                PlatformSpendMonthLedger.exposure(jdbc, period.month()), amount,
                settings.globalMonthSoftUsd(), settings.globalMonthHardUsd());
            if (unavailable != null) throw new PlatformSpendExhaustedException(unavailable);
            completion = new PlatformCompletionEnvelope("completion-v1", settings.policyRevision(), allowedModels, runBudget);
        }
        // Never shrink an admission to leftover money. Insufficient full capacity
        // rejects the transaction before any run or dispatch outbox is accepted.
        // Account/day/week controls restrict new admissions only; existing run scopes are immutable.
        hold("GLOBAL_DAY", GLOBAL, period.day(), amount, settings.globalDayUsd());
        hold("GLOBAL_WEEK", GLOBAL, period.week(), amount, settings.globalWeekUsd());
        hold("ACCOUNT_WEEK", userId, period.week(), amount, settings.accountWeekUsd());
        jdbc.update("""
            INSERT INTO app.platform_spend_reservation
                (run_id, user_id, provider, model, max_cost_usd, tariff_version, day_period, week_period, valid_until)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, runId, userId, selection.provider().name(), selection.model(), amount, TARIFF_VERSION,
            Date.valueOf(period.day()), Date.valueOf(period.week()), Timestamp.from(period.validUntil()));
        jdbc.update("INSERT INTO app.platform_spend_settlement(run_id, reserved_usd) VALUES (?, ?)", runId, amount);
        if (completion != null) jdbc.update("INSERT INTO app.platform_completion_reservation(run_id,payload) VALUES (?,?::jsonb)",
            runId, MAPPER.writeValueAsString(completion));
        PlatformSpendMonthLedger.refresh(jdbc, period.month());
        return new PlatformBudget(runId, amount, TARIFF_VERSION, period.validUntil(), completion);
    }

    private void hold(String scope, UUID subject, LocalDate period, BigDecimal amount, BigDecimal limit) {
        jdbc.update("""
            INSERT INTO app.platform_spend_bucket(scope, subject_id, period, held_usd)
            VALUES (?, ?, ?, 0) ON CONFLICT DO NOTHING
            """, scope, subject, Date.valueOf(period));
        int changed = jdbc.update("""
            UPDATE app.platform_spend_bucket SET held_usd = held_usd + ?
            WHERE scope = ? AND subject_id = ? AND period = ? AND held_usd + ? <= ?
            """, amount, scope, subject, Date.valueOf(period), amount, limit);
        if (changed != 1) throw new PlatformSpendExhaustedException(scope);
    }

    record Settings(BigDecimal accountWeekUsd, BigDecimal globalDayUsd, BigDecimal globalWeekUsd,
                    BigDecimal globalMonthSoftUsd, BigDecimal globalMonthHardUsd,
                    long policyRevision, List<String> routerModels, boolean completionRequired) { }
    record Reservation(UUID userId, String provider, String model, PlatformBudget budget) { }
    record Period(LocalDate day, LocalDate week, Instant validUntil) {
        LocalDate month() { return day.withDayOfMonth(1); }
        static Period at(Instant now) {
            LocalDate day = now.atZone(TIMEZONE).toLocalDate();
            LocalDate week = day.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
            return new Period(day, week, day.plusDays(1).atStartOfDay(TIMEZONE).toInstant());
        }
    }
}
