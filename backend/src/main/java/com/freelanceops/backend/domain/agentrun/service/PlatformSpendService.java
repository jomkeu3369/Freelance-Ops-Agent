package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.client.dto.request.InternalAgentRunRequest.PlatformBudget;
import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest.ModelSelection;
import com.freelanceops.backend.domain.agentrun.repository.JdbcPlatformSpendRepository;
import com.freelanceops.backend.domain.agentrun.repository.JdbcPlatformSpendRepository.Reservation;
import com.freelanceops.backend.domain.agentrun.repository.JdbcPlatformSpendRepository.Settings;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.TemporalAdjusters;
import java.util.UUID;

/**
 * 사용자 크레딧과 별도로 금액을 예약한다. V2 예약의 미사용분은 작업자가 원장을 닫은 뒤 반환한다. 사용량이 불명확하거나 기존 형식인 예약은 삭제·초기화 후에도 유지한다.
 */
@Service
public class PlatformSpendService {
    public static final String TARIFF_VERSION = PlatformSpendTariff.VERSION;
    static final ZoneId TIMEZONE = ZoneId.of("Asia/Seoul");
    private static final UUID GLOBAL = new UUID(0L, 0L);
    private final JdbcPlatformSpendRepository repository;
    private final boolean enabled;

    public PlatformSpendService(
            JdbcPlatformSpendRepository repository,
            @Value("${platform.ai.spend.enabled:false}") boolean enabled) {
        this.repository = repository;
        this.enabled = enabled;
    }

    /** 사용자 크레딧·실행·발송 대기 명령과 같은 트랜잭션에서 처리한다. */
    @Transactional(propagation = Propagation.MANDATORY)
    public PlatformBudget reserve(UUID userId, UUID runId, ModelSelection selection) {
        return reserve(userId, runId, selection, null);
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public PlatformBudget reserve(
            UUID userId, UUID runId, ModelSelection selection, BigDecimal operationCap) {
        if (!enabled) throw new PlatformSpendUnavailableException();
        if (userId == null || runId == null || selection == null)
            throw new IllegalArgumentException("Admission identity is required");
        PlatformSpendTariff.validateSelection(selection);
        // 데이터베이스의 설정 행 하나로 예약을 직렬화해 인스턴스별 환경 설정이 달라도 같은 금액 상한을 적용한다.
        Settings settings = repository.lockSettings();
        if (settings == null)
            throw new IllegalStateException("Platform spending settings unavailable");
        var existing = repository.findReservation(runId);
        if (!existing.isEmpty()) {
            Reservation previous = existing.getFirst();
            if (!previous.userId().equals(userId)
                    || !previous.provider().equals(selection.provider().name())
                    || !previous.model().equals(selection.model())) {
                throw new ResponseStatusException(
                        HttpStatus.CONFLICT, "Run monetary reservation identity does not match");
            }
            return previous.budget();
        }
        Instant now = repository.databaseTime();
        if (now == null) throw new IllegalStateException("Database clock unavailable");
        Period period = Period.at(now);
        if (selection.credentialId() == null)
            PlatformSpendTariff.requireCurrentPrice(selection.model(), now);
        var caps = repository.findEnabledModelCaps(selection.provider().name(), selection.model());
        if (caps.isEmpty() || caps.getFirst().signum() <= 0)
            throw new PlatformSpendUnavailableException();
        BigDecimal amount =
                caps.getFirst()
                        .min(remaining("GLOBAL_DAY", GLOBAL, period.day(), settings.globalDayUsd()))
                        .min(
                                remaining(
                                        "GLOBAL_WEEK",
                                        GLOBAL,
                                        period.week(),
                                        settings.globalWeekUsd()))
                        .min(
                                remaining(
                                        "ACCOUNT_WEEK",
                                        userId,
                                        period.week(),
                                        settings.accountWeekUsd()));
        if (operationCap != null) {
            if (operationCap.signum() <= 0)
                throw new IllegalArgumentException("Invalid operation cap");
            amount = amount.min(operationCap);
        }
        // 라우팅 비용이 발생하므로 플랫폼 호출이 있는 기존 개인 키 실행도 플랫폼 금액을 예약한다.
        hold("GLOBAL_DAY", GLOBAL, period.day(), amount, settings.globalDayUsd());
        hold("GLOBAL_WEEK", GLOBAL, period.week(), amount, settings.globalWeekUsd());
        hold("ACCOUNT_WEEK", userId, period.week(), amount, settings.accountWeekUsd());
        repository.insertReservation(
                runId,
                userId,
                selection.provider().name(),
                selection.model(),
                amount,
                TARIFF_VERSION,
                period.day(),
                period.week(),
                period.validUntil());
        repository.insertSettlement(runId, amount);
        return new PlatformBudget(runId, amount, TARIFF_VERSION, period.validUntil());
    }

    private BigDecimal remaining(String scope, UUID subject, LocalDate period, BigDecimal limit) {
        var held = repository.findBucket(scope, subject, period);
        BigDecimal remaining = limit.subtract(held.isEmpty() ? BigDecimal.ZERO : held.getFirst());
        if (remaining.signum() <= 0) throw new PlatformSpendExhaustedException(scope);
        return remaining;
    }

    private void hold(
            String scope, UUID subject, LocalDate period, BigDecimal amount, BigDecimal limit) {
        repository.insertBucket(scope, subject, period);
        int changed = repository.holdBucket(amount, scope, subject, period, limit);
        if (changed != 1) throw new PlatformSpendExhaustedException(scope);
    }

    record Period(LocalDate day, LocalDate week, Instant validUntil) {
        static Period at(Instant now) {
            LocalDate day = now.atZone(TIMEZONE).toLocalDate();
            LocalDate week = day.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
            return new Period(day, week, day.plusDays(1).atStartOfDay(TIMEZONE).toInstant());
        }
    }
}
