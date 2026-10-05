package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView;
import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView.ProviderCallUsage;
import com.freelanceops.backend.domain.agentrun.entity.AgentRunEntity;
import com.freelanceops.backend.domain.agentrun.model.AgentRunStatus;
import com.freelanceops.backend.domain.agentrun.model.Provider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.charset.StandardCharsets;
import java.sql.Date;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.*;

/** Internal methods take a trusted subject ID. Controllers must authorize that subject.
 * Money is never refunded because of a status label alone, credit reset or deletion.
 */
@Service
public class PlatformUsageService {
    private static final BigDecimal ZERO = BigDecimal.ZERO.setScale(8);
    private static final UUID GLOBAL = new UUID(0, 0);
    private static final Set<AgentRunStatus> TERMINAL = EnumSet.of(AgentRunStatus.COMPLETED,
        AgentRunStatus.PARTIAL, AgentRunStatus.FAILED, AgentRunStatus.CANCELLED);
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    private final boolean enabled;
    public PlatformUsageService(JdbcTemplate jdbc, ObjectMapper mapper,
                                @Value("${platform.ai.spend.enabled:false}") boolean enabled) {
        this.jdbc = jdbc; this.mapper = mapper; this.enabled = enabled;
    }
    public record Model(String provider, String model, boolean catalogued, boolean enabled,
                        List<String> reasoningEfforts, BigDecimal maxRunUsd, boolean available, String unavailableReason,
                        boolean providerAccessVerified) { }
    public record Usage(String currency, BigDecimal limitUsd, BigDecimal settledUsd, BigDecimal reservedUsd,
                        BigDecimal remainingUsd, BigDecimal remainingPercent, BigDecimal reservedPercent,
                        LocalDate periodStart, Instant resetAt, String timezone, boolean spendingEnabled,
                        List<Model> models) { }
    public record UsageEntry(UUID runId, String model, String status, Instant startedAt,
                             BigDecimal platformCostUsd, BigDecimal platformReservedUsd, boolean usageKnown,
                             long byokInputTokens, long byokOutputTokens, List<ProviderCallUsage> providerCalls) { }
    public record History(List<UsageEntry> items, String nextCursor) { }
    private record Hold(UUID user, BigDecimal cap, String version, LocalDate day, LocalDate week,
                        BigDecimal settled, BigDecimal reserved, boolean closed, Instant observed) { }

    @Transactional(propagation = Propagation.MANDATORY)
    public void synchronize(AgentRunEntity run, AgentRunView view) {
        var usage = view.usage();
        if (usage == null || usage.platformReservationId() == null) return;
        if (!run.id().equals(usage.platformReservationId()) || !run.id().equals(view.runId()))
            throw new IllegalArgumentException("Usage reservation identity mismatch");
        // Same lock order as admission. This serializes releases with all new holds.
        jdbc.queryForObject("SELECT id FROM app.platform_spend_settings WHERE id=1 FOR UPDATE", Integer.class);
        var rows = jdbc.query("""
            SELECT r.user_id,r.max_cost_usd,r.tariff_version,r.day_period,r.week_period,
                   s.settled_usd,s.reserved_usd,s.execution_closed,s.observed_at
            FROM app.platform_spend_reservation r JOIN app.platform_spend_settlement s USING(run_id)
            WHERE r.run_id=? FOR UPDATE OF s
            """, (r, n) -> new Hold(r.getObject(1, UUID.class), r.getBigDecimal(2), r.getString(3),
                r.getDate(4).toLocalDate(), r.getDate(5).toLocalDate(), r.getBigDecimal(6), r.getBigDecimal(7),
                r.getBoolean(8), r.getTimestamp(9) == null ? null : r.getTimestamp(9).toInstant()), run.id());
        if (rows.isEmpty()) throw new IllegalArgumentException("Usage reservation is missing");
        Hold hold = rows.getFirst();
        if (!hold.user().equals(run.initiatedBy()) || !hold.version().equals(usage.tariffVersion()))
            throw new IllegalArgumentException("Usage tariff or account mismatch");
        if (hold.observed() != null && view.updatedAt().isBefore(hold.observed())) return;
        if (usage.providerCalls().size() != usage.modelCalls()) return; // Incomplete snapshot: retain exposure.
        var previous = attempts(run.id());
        Map<UUID, ProviderCallUsage> merged = new LinkedHashMap<>();
        previous.forEach(call -> merged.put(call.callId(), call));
        for (var call : usage.providerCalls()) {
            if ("BYOK".equals(call.fundingSource()) && (run.credentialId() == null
                || call.provider() != run.provider() || !call.model().equals(run.model())))
                throw new IllegalArgumentException("Personal usage binding mismatch");
            var prior = merged.get(call.callId());
            if (prior != null) {
                if (prior.provider() != call.provider() || !prior.model().equals(call.model())
                    || !prior.operation().equals(call.operation()) || !prior.fundingSource().equals(call.fundingSource())
                    || prior.reservedCostUsd().compareTo(call.reservedCostUsd()) != 0)
                    throw new IllegalArgumentException("Attempt identity changed");
                if (prior.usageKnown()) {
                    if (call.usageKnown() && !sameUsage(prior, call)) throw new IllegalArgumentException("Settled attempt changed");
                    continue; // A delayed pre-call snapshot cannot undo settlement.
                }
            } else if (hold.closed()) {
                throw new IllegalArgumentException("Closed execution reported a new attempt");
            }
            merged.put(call.callId(), call);
            int changed = jdbc.update("""
                INSERT INTO app.platform_provider_attempt(call_id,run_id,payload) VALUES (?,?,?::jsonb)
                ON CONFLICT(call_id) DO UPDATE SET payload=EXCLUDED.payload,updated_at=clock_timestamp()
                WHERE platform_provider_attempt.run_id=EXCLUDED.run_id
                """, call.callId(), run.id(), mapper.writeValueAsString(call));
            if (changed != 1) throw new IllegalArgumentException("Attempt belongs to another run");
        }
        BigDecimal settled = ZERO, unknown = ZERO;
        boolean priceable = !usage.unpricedExposure();
        for (var call : merged.values()) {
            if ("BYOK".equals(call.fundingSource())) continue;
            BigDecimal cost = PlatformSpendTariff.conservativeCost(List.of(call), 1, hold.version());
            if (cost == null) { priceable = false; continue; }
            if (call.usageKnown()) settled = settled.add(cost); else unknown = unknown.add(cost);
        }
        boolean closed = hold.closed() || (usage.executionClosed() && TERMINAL.contains(view.status()));
        // Legacy caps remain permanently held. Missing/unpriceable reports also
        // retain the whole cap; known amounts are still displayed separately.
        BigDecimal exposure = settled.add(unknown);
        if (!closed || !priceable || PlatformSpendTariff.LEGACY_VERSION.equals(hold.version())) exposure = exposure.max(hold.cap());
        BigDecimal reserved = exposure.subtract(settled).max(ZERO);
        BigDecimal delta = exposure.subtract(hold.settled().add(hold.reserved()));
        adjust("GLOBAL_DAY", GLOBAL, hold.day(), delta);
        adjust("GLOBAL_WEEK", GLOBAL, hold.week(), delta);
        adjust("ACCOUNT_WEEK", hold.user(), hold.week(), delta);
        jdbc.update("""
            UPDATE app.platform_spend_settlement SET settled_usd=?,reserved_usd=?,execution_closed=?,
                observed_at=?,updated_at=clock_timestamp() WHERE run_id=?
            """, settled, reserved, closed, Timestamp.from(view.updatedAt()), run.id());
    }
    private static boolean sameUsage(ProviderCallUsage a, ProviderCallUsage b) {
        return a.inputTokens() == b.inputTokens() && a.outputTokens() == b.outputTokens()
            && a.cachedReadTokens() == b.cachedReadTokens() && a.cacheWriteTokens() == b.cacheWriteTokens();
    }
    private void adjust(String scope, UUID subject, LocalDate period, BigDecimal delta) {
        if (delta.signum() == 0) return;
        if (jdbc.update("""
            UPDATE app.platform_spend_bucket SET held_usd=held_usd+?
            WHERE scope=? AND subject_id=? AND period=? AND held_usd+? >= 0
            """, delta, scope, subject, Date.valueOf(period), delta) != 1)
            throw new IllegalStateException("Monetary bucket is inconsistent");
    }
    private List<ProviderCallUsage> attempts(UUID run) {
        return jdbc.query("SELECT payload::text FROM app.platform_provider_attempt WHERE run_id=? ORDER BY call_id",
            (row, n) -> mapper.readValue(row.getString(1), ProviderCallUsage.class), run);
    }
    @Transactional
    public Usage snapshot(UUID userId) {
        Objects.requireNonNull(userId);
        Instant now = jdbc.queryForObject("SELECT clock_timestamp()", Timestamp.class).toInstant();
        var period = FreeUsageService.Period.at(now);
        var settings = jdbc.queryForObject("""
            SELECT account_week_usd, global_day_usd, global_week_usd FROM app.platform_spend_settings WHERE id=1 FOR SHARE
            """, (row, n) -> List.of(row.getBigDecimal(1), row.getBigDecimal(2), row.getBigDecimal(3)));
        BigDecimal limit = settings.getFirst();
        var totals = jdbc.queryForObject("""
            SELECT COALESCE(SUM(s.settled_usd),0), COALESCE(SUM(s.reserved_usd),0)
            FROM app.platform_spend_reservation r JOIN app.platform_spend_settlement s USING(run_id)
            WHERE r.user_id=? AND r.week_period=?
            """, (row, n) -> List.of(row.getBigDecimal(1), row.getBigDecimal(2)), userId, Date.valueOf(period.start()));
        BigDecimal remaining = limit.subtract(totals.get(0)).subtract(totals.get(1)).max(ZERO);
        BigDecimal globalRemaining = available("GLOBAL_DAY", GLOBAL, PlatformSpendService.Period.at(now).day(), settings.get(1))
            .min(available("GLOBAL_WEEK", GLOBAL, period.start(), settings.get(2)));
        List<Model> models = jdbc.query("SELECT model,max_run_usd,enabled FROM app.platform_spend_model_cap ORDER BY model",
            (row, n) -> {
                String id = row.getString(1);
                boolean active = row.getBoolean(3);
                String reason = !enabled ? "SPENDING_DISABLED" : !active ? "MODEL_DISABLED"
                    : (id.equals("gpt-5.6-sol") && !now.isBefore(PlatformSpendTariff.PROMOTION_REVIEW_AT)) ? "TARIFF_REVIEW_REQUIRED"
                    : remaining.signum() <= 0 ? "ACCOUNT_BUDGET_EXHAUSTED"
                    : globalRemaining.signum() <= 0 ? "GLOBAL_BUDGET_EXHAUSTED" : null;
                var efforts = List.of("gpt-6.1-sol", "gpt-6-astra").contains(id)
                    ? List.of("LOW", "MEDIUM", "HIGH") : List.of("NONE", "LOW", "MEDIUM", "HIGH");
                return new Model("OPENAI", id, true, active, efforts, row.getBigDecimal(2), reason == null, reason, false);
            });
        return new Usage("USD", limit, totals.get(0), totals.get(1), remaining, percent(remaining, limit),
            percent(totals.get(1), limit), period.start(), period.resetAt(), "Asia/Seoul", enabled, models);
    }
    private BigDecimal available(String scope, UUID subject, LocalDate period, BigDecimal limit) {
        var held = jdbc.query("SELECT held_usd FROM app.platform_spend_bucket WHERE scope=? AND subject_id=? AND period=?",
            (row, n) -> row.getBigDecimal(1), scope, subject, Date.valueOf(period));
        return limit.subtract(held.isEmpty() ? ZERO : held.getFirst()).max(ZERO);
    }
    static BigDecimal percent(BigDecimal amount, BigDecimal limit) {
        return limit.signum() == 0 ? BigDecimal.ZERO : amount.multiply(BigDecimal.valueOf(100))
            .divide(limit, 4, RoundingMode.DOWN).min(BigDecimal.valueOf(100)).max(BigDecimal.ZERO);
    }
    private List<ProviderCallUsage> personalAttempts(UUID scope, String model) {
        // These are conservative admissions, not an asserted provider bill or a known actual usage total.
        return jdbc.query("SELECT call_id,operation,input_tokens,output_tokens FROM app.byok_provider_attempt WHERE scope_id=? ORDER BY created_at,call_id",
            (row,n) -> new ProviderCallUsage(row.getObject(1,UUID.class),Provider.OPENAI,model,row.getString(2),
                row.getLong(3),row.getLong(4),0,0,ZERO,ZERO,false,"BYOK"),scope);
    }
    @Transactional(readOnly = true)
    public History history(UUID userId, String cursor, int limit) {
        Objects.requireNonNull(userId);
        if (limit < 1 || limit > 100) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Limit must be 1..100");
        Instant before = Instant.parse("9999-12-31T00:00:00Z");
        UUID beforeId = new UUID(-1,-1);
        if (cursor != null) {
            try {
                String[] decoded = new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8).split("\\|", -1);
                before = Instant.parse(decoded[0]); beforeId = UUID.fromString(decoded[1]);
                if (decoded.length != 2) throw new IllegalArgumentException();
            } catch (RuntimeException error) { throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid usage cursor"); }
        }
        var items = jdbc.query("""
            SELECT r.run_id,r.model,COALESCE(a.status,'DELETED'),r.created_at,r.settled_usd,r.reserved_usd,
                   r.execution_closed,r.byok_scope_id,r.byok_input_tokens,r.byok_output_tokens
            FROM (
                SELECT p.run_id,p.model,p.created_at,s.settled_usd,s.reserved_usd,s.execution_closed,
                       NULL::uuid AS byok_scope_id,0::bigint AS byok_input_tokens,0::bigint AS byok_output_tokens
                FROM app.platform_spend_reservation p JOIN app.platform_spend_settlement s USING(run_id) WHERE p.user_id=?
                UNION ALL
                SELECT b.run_id,b.payload->>'model',b.created_at,0::numeric,0::numeric,b.closed,
                       b.scope_id,b.input_tokens,b.output_tokens
                FROM app.byok_execution_scope b WHERE b.payload->>'initiatedBy'=?
            ) r LEFT JOIN app.agent_run a ON a.id=r.run_id
            WHERE (r.created_at,r.run_id) < (?,?) ORDER BY r.created_at DESC,r.run_id DESC LIMIT ?
            """, (row, n) -> {
                UUID run = row.getObject(1,UUID.class), byokScope = row.getObject(8,UUID.class);
                var calls = byokScope == null ? attempts(run) : personalAttempts(byokScope, row.getString(2));
                return new UsageEntry(run,row.getString(2),row.getString(3),row.getTimestamp(4).toInstant(),
                    row.getBigDecimal(5),row.getBigDecimal(6),byokScope == null && row.getBoolean(7)
                        && row.getBigDecimal(6).signum()==0 && calls.stream().allMatch(ProviderCallUsage::usageKnown),
                    byokScope == null ? calls.stream().filter(c -> "BYOK".equals(c.fundingSource())).mapToLong(ProviderCallUsage::inputTokens).sum() : row.getLong(9),
                    byokScope == null ? calls.stream().filter(c -> "BYOK".equals(c.fundingSource())).mapToLong(ProviderCallUsage::outputTokens).sum() : row.getLong(10),calls);
            }, userId, userId.toString(), Timestamp.from(before), beforeId, limit+1);
        boolean more = items.size() > limit;
        items = List.copyOf(items.subList(0, Math.min(items.size(), limit)));
        String next = null;
        if (more) {
            var last = items.getLast();
            next = Base64.getUrlEncoder().withoutPadding().encodeToString(
                (last.startedAt()+"|"+last.runId()).getBytes(StandardCharsets.UTF_8));
        }
        return new History(items,next);
    }
}
