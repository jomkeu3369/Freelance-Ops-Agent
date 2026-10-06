package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.model.Provider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Changes future monetary admission only. Existing reservations, usage and tariffs are immutable.
 * The deployment spending switch is deliberately read-only and has no mutation/reset API.
 */
@Service
public class PlatformSpendAdminService {
    public static final BigDecimal MAX_BUDGET_USD = new BigDecimal("100000");
    public static final BigDecimal MAX_MODEL_RUN_USD = new BigDecimal("100");
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    private final boolean spendingEnabled;

    public PlatformSpendAdminService(JdbcTemplate jdbc, ObjectMapper mapper,
                                     @Value("${platform.ai.spend.enabled:false}") boolean spendingEnabled) {
        this.jdbc = jdbc;
        this.mapper = mapper;
        this.spendingEnabled = spendingEnabled;
    }

    public record ModelCap(Provider provider, String model, BigDecimal maxRunUsd, boolean enabled) { }
    public record Settings(String currency, BigDecimal accountWeekUsd, BigDecimal globalDayUsd,
                           BigDecimal globalWeekUsd, long revision, Instant updatedAt, boolean spendingEnabled,
                           List<ModelCap> models, BigDecimal maxBudgetUsd, BigDecimal maxModelRunUsd) { }
    private record Budgets(BigDecimal accountWeekUsd, BigDecimal globalDayUsd, BigDecimal globalWeekUsd) { }

    @Transactional
    public Settings settings(UUID actor) {
        requireAdmin(actor);
        return snapshot(false);
    }

    @Transactional
    public Settings changeBudgets(UUID actor, BigDecimal accountWeekUsd, BigDecimal globalDayUsd,
                                  BigDecimal globalWeekUsd, Long expectedRevision) {
        requireAdmin(actor);
        validateAmount(accountWeekUsd, MAX_BUDGET_USD);
        validateAmount(globalDayUsd, MAX_BUDGET_USD);
        validateAmount(globalWeekUsd, MAX_BUDGET_USD);
        validateRevision(expectedRevision);
        Settings before = snapshot(true);
        requireRevision(before, expectedRevision);
        if (same(accountWeekUsd, before.accountWeekUsd()) && same(globalDayUsd, before.globalDayUsd())
            && same(globalWeekUsd, before.globalWeekUsd())) return before;
        requireNextRevision(before);
        jdbc.update("""
            UPDATE app.platform_spend_settings SET account_week_usd=?,global_day_usd=?,global_week_usd=?,
                revision=revision+1,updated_at=GREATEST(clock_timestamp(),updated_at+INTERVAL '1 microsecond') WHERE id=1
            """, accountWeekUsd, globalDayUsd, globalWeekUsd);
        Settings after = snapshot(false);
        audit(actor, "CHANGE_BUDGETS", "budgets", budgets(before), budgets(after), before.revision(), after.revision());
        return after;
    }

    @Transactional
    public Settings changeModel(UUID actor, Provider provider, String model, BigDecimal maxRunUsd,
                                Boolean enabled, Long expectedRevision) {
        requireAdmin(actor);
        validateAmount(maxRunUsd, MAX_MODEL_RUN_USD);
        validateRevision(expectedRevision);
        if (provider == null || model == null || model.isBlank() || model.length() > 100 || enabled == null)
            throw badRequest("A supported model and enabled flag are required");
        Settings before = snapshot(true);
        requireRevision(before, expectedRevision);
        ModelCap old = before.models().stream().filter(cap -> cap.provider() == provider && cap.model().equals(model))
            .findFirst().orElseThrow(() -> badRequest("Unsupported platform model"));
        if (same(maxRunUsd, old.maxRunUsd()) && enabled == old.enabled()) return before;
        requireNextRevision(before);
        if (jdbc.update("UPDATE app.platform_spend_model_cap SET max_run_usd=?,enabled=? WHERE provider=? AND model=?",
            maxRunUsd, enabled, provider.name(), model) != 1) throw new IllegalStateException("Platform model is missing");
        jdbc.update("""
            UPDATE app.platform_spend_settings SET revision=revision+1,
                updated_at=GREATEST(clock_timestamp(),updated_at+INTERVAL '1 microsecond') WHERE id=1
            """);
        Settings after = snapshot(false);
        audit(actor, "CHANGE_MODEL", provider.name() + ":" + model, old,
            new ModelCap(provider, model, maxRunUsd, enabled), before.revision(), after.revision());
        return after;
    }

    private Settings snapshot(boolean write) {
        // Always acquire this row first, including for model edits. Admission and settlement use
        // the same lock so a run observes one coherent set of budgets/caps, never a partial edit.
        Settings base = jdbc.queryForObject("""
            SELECT account_week_usd,global_day_usd,global_week_usd,revision,updated_at
            FROM app.platform_spend_settings WHERE id=1
            """ + (write ? " FOR UPDATE" : " FOR SHARE"), (row, n) -> new Settings("USD", row.getBigDecimal(1),
            row.getBigDecimal(2), row.getBigDecimal(3), row.getLong(4), row.getTimestamp(5).toInstant(),
            spendingEnabled, List.of(), MAX_BUDGET_USD, MAX_MODEL_RUN_USD));
        if (base == null) throw new IllegalStateException("Platform spending settings unavailable");
        List<ModelCap> models = jdbc.query("SELECT provider,model,max_run_usd,enabled FROM app.platform_spend_model_cap ORDER BY provider,model",
            (row, n) -> new ModelCap(Provider.valueOf(row.getString(1)), row.getString(2), row.getBigDecimal(3), row.getBoolean(4)));
        return new Settings(base.currency(), base.accountWeekUsd(), base.globalDayUsd(), base.globalWeekUsd(),
            base.revision(), base.updatedAt(), spendingEnabled, models, MAX_BUDGET_USD, MAX_MODEL_RUN_USD);
    }

    private void requireAdmin(UUID actor) {
        // Match account verification eligibility used by member administration, including legacy
        // accounts. Hold both rows until commit so revocation/deactivation cannot race a write.
        var grants = jdbc.query("""
            SELECT g.user_id FROM app.platform_admin_grant g
            JOIN app.user_account a ON a.id=g.user_id AND a.status='ACTIVE' AND NOT a.email_verification_required
            WHERE g.user_id=? AND g.capability='FREE_USAGE_ADMIN' AND g.revoked_at IS NULL
            FOR SHARE OF g,a
            """, (row, n) -> row.getObject(1, UUID.class), actor);
        if (grants.isEmpty()) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Platform administrator capability required");
    }

    static void validateAmount(BigDecimal value, BigDecimal maximum) {
        // Check before JDBC: NUMERIC(19,8) would otherwise silently round fractional USD.
        if (value == null || value.signum() < 0 || value.scale() > 8 || value.compareTo(maximum) > 0)
            throw badRequest("USD amounts must be between 0 and " + maximum.toPlainString() + " with at most 8 decimal places");
    }
    private static void validateRevision(Long revision) {
        if (revision == null || revision < 0) throw badRequest("A nonnegative expected revision is required");
    }
    private static void requireRevision(Settings before, long expected) {
        if (before.revision() != expected) throw new ResponseStatusException(HttpStatus.CONFLICT,
            "Platform spending settings changed; reload before trying again");
    }
    private static void requireNextRevision(Settings before) {
        if (before.revision() == Long.MAX_VALUE) throw new ResponseStatusException(HttpStatus.CONFLICT,
            "Platform spending settings revision exhausted");
    }
    private static boolean same(BigDecimal a, BigDecimal b) { return a.compareTo(b) == 0; }
    private static Budgets budgets(Settings settings) {
        return new Budgets(settings.accountWeekUsd(), settings.globalDayUsd(), settings.globalWeekUsd());
    }
    private void audit(UUID actor, String action, String target, Object previous, Object next, long before, long after) {
        jdbc.update("""
            INSERT INTO app.platform_spend_admin_audit
                (id,actor_user_id,action,target,previous_value,new_value,previous_revision,new_revision)
            VALUES (?,?,?,?,?,?,?,?)
            """, UUID.randomUUID(), actor, action, target, mapper.writeValueAsString(previous), mapper.writeValueAsString(next), before, after);
    }
    private static ResponseStatusException badRequest(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }
}
