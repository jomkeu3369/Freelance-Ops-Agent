package com.freelanceops.backend.domain.agentrun.dto.response;

import com.freelanceops.backend.domain.agentrun.service.PlatformSpendAdminService;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

/** Plain decimal strings preserve all NUMERIC(19,8) digits, including operator-configured
 * legacy budgets above the current edit ceiling. Arithmetic remains BigDecimal in the service.
 */
public record PlatformSpendAdminSettingsResponse(
    String currency, String accountWeekUsd, String globalDayUsd, String globalWeekUsd,
    long revision, Instant updatedAt, boolean spendingEnabled,
    List<PlatformSpendAdminService.ModelCap> models, BigDecimal maxBudgetUsd, BigDecimal maxModelRunUsd) {

    public static PlatformSpendAdminSettingsResponse from(PlatformSpendAdminService.Settings settings) {
        return new PlatformSpendAdminSettingsResponse(settings.currency(), settings.accountWeekUsd().toPlainString(),
            settings.globalDayUsd().toPlainString(), settings.globalWeekUsd().toPlainString(), settings.revision(),
            settings.updatedAt(), settings.spendingEnabled(), settings.models(), settings.maxBudgetUsd(), settings.maxModelRunUsd());
    }
}
