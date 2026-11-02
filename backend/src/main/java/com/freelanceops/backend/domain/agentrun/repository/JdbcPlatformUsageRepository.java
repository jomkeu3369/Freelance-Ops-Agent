package com.freelanceops.backend.domain.agentrun.repository;

import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView.ExternalToolCallUsage;
import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView.ProviderCallUsage;
import com.freelanceops.backend.domain.agentrun.dto.response.PlatformUsageEntryResponse;
import com.freelanceops.backend.domain.agentrun.model.Provider;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import tools.jackson.databind.ObjectMapper;

import java.math.BigDecimal;
import java.sql.Date;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.*;
import java.util.List;
import java.util.UUID;

@Repository
public class JdbcPlatformUsageRepository {
    private static final BigDecimal ZERO = BigDecimal.ZERO.setScale(8);

    public record ModelCap(String model, BigDecimal maxRunUsd, boolean enabled) {}

    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    public JdbcPlatformUsageRepository(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    public record Hold(
            UUID user,
            BigDecimal cap,
            String version,
            LocalDate day,
            LocalDate week,
            BigDecimal settled,
            BigDecimal reserved,
            boolean closed,
            Instant observed) {}

    public Integer lockSettings() {
        return jdbc.queryForObject(
                "SELECT id FROM app.platform_spend_settings WHERE id=1 FOR UPDATE", Integer.class);
    }

    public List<Hold> findSettlement(UUID operationId) {
        return jdbc.query(
                """
                        SELECT r.user_id,r.max_cost_usd,r.tariff_version,r.day_period,r.week_period,
                               s.settled_usd,s.reserved_usd,s.execution_closed,s.observed_at
                        FROM app.platform_spend_reservation r JOIN app.platform_spend_settlement s USING(run_id)
                        WHERE r.run_id=? FOR UPDATE OF s
                        """,
                (r, n) ->
                        new Hold(
                                r.getObject(1, UUID.class),
                                r.getBigDecimal(2),
                                r.getString(3),
                                r.getDate(4).toLocalDate(),
                                r.getDate(5).toLocalDate(),
                                r.getBigDecimal(6),
                                r.getBigDecimal(7),
                                r.getBoolean(8),
                                r.getTimestamp(9) == null ? null : r.getTimestamp(9).toInstant()),
                operationId);
    }

    public int upsertProviderAttempt(UUID callId, UUID operationId, String payload) {
        return jdbc.update(
                """
                            INSERT INTO app.platform_provider_attempt(call_id,run_id,payload) VALUES (?,?,?::jsonb)
                            ON CONFLICT(call_id) DO UPDATE SET payload=EXCLUDED.payload,updated_at=clock_timestamp()
                            WHERE platform_provider_attempt.run_id=EXCLUDED.run_id
                            """,
                callId,
                operationId,
                payload);
    }

    public int updateSettlement(
            BigDecimal settled,
            BigDecimal reserved,
            boolean closed,
            Instant observedAt,
            UUID operationId) {
        return jdbc.update(
                """
                UPDATE app.platform_spend_settlement SET settled_usd=?,reserved_usd=?,execution_closed=?,
                    observed_at=?,updated_at=clock_timestamp() WHERE run_id=?
                """,
                settled,
                reserved,
                closed,
                Timestamp.from(observedAt),
                operationId);
    }

    public int adjustBucket(BigDecimal delta, String scope, UUID subject, LocalDate period) {
        return jdbc.update(
                """
                        UPDATE app.platform_spend_bucket SET held_usd=held_usd+?
                        WHERE scope=? AND subject_id=? AND period=? AND held_usd+? >= 0
                        """,
                delta,
                scope,
                subject,
                Date.valueOf(period),
                delta);
    }

    public List<ProviderCallUsage> listProviderAttempts(UUID run) {
        return jdbc.query(
                "SELECT payload::text FROM app.platform_provider_attempt WHERE run_id=? ORDER BY"
                        + " call_id",
                (row, n) -> mapper.readValue(row.getString(1), ProviderCallUsage.class),
                run);
    }

    public List<ExternalToolCallUsage> listExternalAttempts(UUID run) {
        return jdbc.query(
                "SELECT payload::text FROM app.platform_external_tool_attempt WHERE run_id=?",
                (row, index) -> mapper.readValue(row.getString(1), ExternalToolCallUsage.class),
                run);
    }

    public int upsertExternalAttempt(UUID callId, UUID run, String payload) {
        return jdbc.update(
                "INSERT INTO app.platform_external_tool_attempt(call_id,run_id,payload) VALUES (?,?,?::jsonb)"
                        + " ON CONFLICT(call_id) DO UPDATE SET payload=EXCLUDED.payload,updated_at=clock_timestamp()"
                        + " WHERE platform_external_tool_attempt.run_id=EXCLUDED.run_id",
                callId,
                run,
                payload);
    }

    public Instant databaseTime() {
        Timestamp value = jdbc.queryForObject("SELECT clock_timestamp()", Timestamp.class);
        return value == null ? null : value.toInstant();
    }

    public List<BigDecimal> findBudgetLimits() {
        return jdbc.queryForObject(
                """
                        SELECT account_week_usd, global_day_usd, global_week_usd FROM app.platform_spend_settings WHERE id=1 FOR SHARE
                        """,
                (row, n) ->
                        List.of(row.getBigDecimal(1), row.getBigDecimal(2), row.getBigDecimal(3)));
    }

    public List<BigDecimal> findWeeklyTotals(UUID userId, LocalDate periodStart) {
        return jdbc.queryForObject(
                """
                        SELECT COALESCE(SUM(s.settled_usd),0), COALESCE(SUM(s.reserved_usd),0)
                        FROM app.platform_spend_reservation r JOIN app.platform_spend_settlement s USING(run_id)
                        WHERE r.user_id=? AND r.week_period=?
                        """,
                (row, n) -> List.of(row.getBigDecimal(1), row.getBigDecimal(2)),
                userId,
                Date.valueOf(periodStart));
    }

    public List<ModelCap> listModelCaps() {
        return jdbc.query(
                "SELECT model,max_run_usd,enabled FROM app.platform_spend_model_cap ORDER"
                        + " BY model",
                (row, n) ->
                        new ModelCap(row.getString(1), row.getBigDecimal(2), row.getBoolean(3)));
    }

    public List<BigDecimal> findBucket(String scope, UUID subject, LocalDate period) {
        return jdbc.query(
                "SELECT held_usd FROM app.platform_spend_bucket WHERE scope=? AND"
                        + " subject_id=? AND period=?",
                (row, n) -> row.getBigDecimal(1),
                scope,
                subject,
                Date.valueOf(period));
    }

    public List<ProviderCallUsage> listPersonalAttempts(UUID scope, String model) {
        return jdbc.query(
                "SELECT call_id,operation,input_tokens,output_tokens FROM app.byok_provider_attempt"
                        + " WHERE scope_id=? ORDER BY created_at,call_id",
                (row, n) ->
                        new ProviderCallUsage(
                                row.getObject(1, UUID.class),
                                Provider.OPENAI,
                                model,
                                row.getString(2),
                                row.getLong(3),
                                row.getLong(4),
                                0,
                                0,
                                ZERO,
                                ZERO,
                                false,
                                "BYOK"),
                scope);
    }

    public List<PlatformUsageEntryResponse> listHistory(
            UUID userId, String userIdText, Instant before, UUID beforeId, int limit) {
        return jdbc.query(
                """
                        SELECT r.run_id,r.model,COALESCE(a.status,
                               CASE WHEN g.status='REQUESTED' AND g.updated_at < clock_timestamp() - interval '90 seconds'
                                    THEN 'UNKNOWN' ELSE g.status END,'DELETED'),r.created_at,r.settled_usd,r.reserved_usd,
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
                        LEFT JOIN app.pet_generation g ON g.id=r.run_id AND g.user_id=? AND g.request_hash IS NOT NULL
                        WHERE (r.created_at,r.run_id) < (?,?) ORDER BY r.created_at DESC,r.run_id DESC LIMIT ?
                        """,
                (row, n) -> {
                    UUID run = row.getObject(1, UUID.class),
                            byokScope = row.getObject(8, UUID.class);
                    var calls =
                            byokScope == null
                                    ? attempts(run)
                                    : personalAttempts(byokScope, row.getString(2));
                    return new PlatformUsageEntryResponse(
                            run,
                            row.getString(2),
                            row.getString(3),
                            row.getTimestamp(4).toInstant(),
                            row.getBigDecimal(5),
                            row.getBigDecimal(6),
                            byokScope == null
                                    && row.getBoolean(7)
                                    && row.getBigDecimal(6).signum() == 0
                                    && calls.stream().allMatch(ProviderCallUsage::usageKnown),
                            byokScope == null
                                    ? calls.stream()
                                            .filter(c -> "BYOK".equals(c.fundingSource()))
                                            .mapToLong(ProviderCallUsage::inputTokens)
                                            .sum()
                                    : row.getLong(9),
                            byokScope == null
                                    ? calls.stream()
                                            .filter(c -> "BYOK".equals(c.fundingSource()))
                                            .mapToLong(ProviderCallUsage::outputTokens)
                                            .sum()
                                    : row.getLong(10),
                            calls);
                },
                userId,
                userIdText,
                userId,
                Timestamp.from(before),
                beforeId,
                limit);
    }

    private List<ProviderCallUsage> attempts(UUID run) {
        return listProviderAttempts(run);
    }

    private List<ProviderCallUsage> personalAttempts(UUID scope, String model) {
        // 예약 상한을 계산한 값이며 실제 청구액이나 확정 사용량을 뜻하지 않는다.
        return listPersonalAttempts(scope, model);
    }
}
