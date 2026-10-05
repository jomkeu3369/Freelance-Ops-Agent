package com.freelanceops.backend.domain.agentrun.service;

import org.junit.jupiter.api.Test;
import java.time.Instant;
import java.time.LocalDate;
import static org.assertj.core.api.Assertions.assertThat;

class FreeUsagePeriodTest {
    @Test void resetsAtMondayMidnightSeoulWithoutScheduler() {
        var before = FreeUsageService.Period.at(Instant.parse("2026-10-04T14:59:59.999999Z"));
        var after = FreeUsageService.Period.at(Instant.parse("2026-10-04T15:00:00Z"));
        assertThat(before.start()).isEqualTo(LocalDate.parse("2026-09-28"));
        assertThat(before.resetAt()).isEqualTo(Instant.parse("2026-10-04T15:00:00Z"));
        assertThat(after.start()).isEqualTo(LocalDate.parse("2026-10-05"));
        assertThat(after.resetAt()).isEqualTo(Instant.parse("2026-10-11T15:00:00Z"));
    }
    @Test void keepsOneWeeklyBucketAcrossMonthYearAndLeapDay() {
        assertThat(FreeUsageService.Period.at(Instant.parse("2026-12-31T15:00:00Z")).start())
            .isEqualTo(LocalDate.parse("2026-12-28"));
        assertThat(FreeUsageService.Period.at(Instant.parse("2028-02-28T15:00:00Z")).start())
            .isEqualTo(LocalDate.parse("2028-02-28"));
        assertThat(FreeUsageService.Period.at(Instant.parse("2028-02-28T15:00:00Z")).resetAt())
            .isEqualTo(Instant.parse("2028-03-05T15:00:00Z"));
    }
}
