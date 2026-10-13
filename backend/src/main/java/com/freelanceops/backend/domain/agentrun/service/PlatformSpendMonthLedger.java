package com.freelanceops.backend.domain.agentrun.service;

import org.springframework.jdbc.core.JdbcTemplate;

import java.math.BigDecimal;
import java.sql.Date;
import java.time.LocalDate;

/** All callers hold the global settings row FOR UPDATE before touching month rows.
 * An old-period settlement can release its old buckets, never this month's carry.
 * Open runs carry their whole remaining execution envelope (including conservative
 * overlap with already-known cost); closed unknown/unpriceable liability also carries.
 */
final class PlatformSpendMonthLedger {
    private PlatformSpendMonthLedger() { }

    static void refresh(JdbcTemplate jdbc, LocalDate month) {
        jdbc.update("""
            INSERT INTO app.platform_spend_month_entry(run_id,month_period,exposure_usd,carried)
            SELECT r.run_id,?,s.settled_usd+s.reserved_usd,FALSE
            FROM app.platform_spend_reservation r JOIN app.platform_spend_settlement s USING(run_id)
            WHERE r.day_period >= ? AND r.day_period < (?::date + INTERVAL '1 month')
            ON CONFLICT(run_id,month_period) DO UPDATE SET exposure_usd=EXCLUDED.exposure_usd
            WHERE NOT platform_spend_month_entry.carried
            """, Date.valueOf(month), Date.valueOf(month), Date.valueOf(month));
        jdbc.update("""
            INSERT INTO app.platform_spend_month_entry(run_id,month_period,exposure_usd,carried)
            SELECT r.run_id,?,CASE WHEN s.execution_closed THEN s.reserved_usd
                ELSE GREATEST(r.max_cost_usd,s.settled_usd+s.reserved_usd) END,TRUE
            FROM app.platform_spend_reservation r JOIN app.platform_spend_settlement s USING(run_id)
            WHERE r.day_period < ? AND (NOT s.execution_closed OR s.reserved_usd > 0)
            ON CONFLICT(run_id,month_period) DO UPDATE SET
                exposure_usd=GREATEST(platform_spend_month_entry.exposure_usd,EXCLUDED.exposure_usd)
            WHERE platform_spend_month_entry.carried
            """, Date.valueOf(month), Date.valueOf(month));
    }

    static BigDecimal exposure(JdbcTemplate jdbc, LocalDate month) {
        return jdbc.queryForObject("SELECT COALESCE(SUM(exposure_usd),0) FROM app.platform_spend_month_entry WHERE month_period=?",
            BigDecimal.class, Date.valueOf(month));
    }

    static String unavailable(BigDecimal exposure, BigDecimal fullReserve, BigDecimal soft, BigDecimal hard) {
        if (soft.signum() <= 0 || hard.compareTo(soft) < 0) return "MONTHLY_POLICY_UNCONFIGURED";
        if (exposure.compareTo(soft) >= 0) return "GLOBAL_MONTH_SOFT_TARGET";
        if (exposure.add(fullReserve).compareTo(hard) > 0) return "GLOBAL_MONTH_HARD_LIMIT";
        return null;
    }
}
