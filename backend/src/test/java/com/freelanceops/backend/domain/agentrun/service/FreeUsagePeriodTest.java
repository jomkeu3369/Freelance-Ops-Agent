package com.freelanceops.backend.domain.agentrun.service;

import org.junit.jupiter.api.Test;
import java.time.Instant;
import java.time.LocalDate;
import static org.assertj.core.api.Assertions.assertThat;

class FreeUsagePeriodTest {
    @Test void resetsAtKoreanCalendarBoundaryWithoutScheduler() {
        var before = FreeUsageService.Period.at(Instant.parse("2026-10-31T14:59:59.999999Z"));
        var after = FreeUsageService.Period.at(Instant.parse("2026-10-31T15:00:00Z"));
        assertThat(before.start()).isEqualTo(LocalDate.parse("2026-10-01"));
        assertThat(before.resetAt()).isEqualTo(Instant.parse("2026-10-31T15:00:00Z"));
        assertThat(after.start()).isEqualTo(LocalDate.parse("2026-11-01"));
        assertThat(after.resetAt()).isEqualTo(Instant.parse("2026-11-30T15:00:00Z"));
    }
    @Test void handlesLeapFebruaryAndYearRollover() {
        assertThat(FreeUsageService.Period.at(Instant.parse("2028-02-28T15:00:00Z")).resetAt())
            .isEqualTo(Instant.parse("2028-02-29T15:00:00Z"));
        assertThat(FreeUsageService.Period.at(Instant.parse("2026-12-31T15:00:00Z")).start())
            .isEqualTo(LocalDate.parse("2027-01-01"));
    }
}
