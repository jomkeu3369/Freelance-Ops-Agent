package com.freelanceops.backend.domain.identity.service;

import com.freelanceops.backend.domain.agentrun.service.PlatformUsageService;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.web.server.ResponseStatusException;
import java.util.List;
import java.util.UUID;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class AdminMemberServiceTest {
    @Test void everyEntryPointDeniesBeforeReadingMetadataOrLedger() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        var usage = mock(PlatformUsageService.class);
        var service = new AdminMemberService(jdbc, usage);
        UUID actor = UUID.randomUUID(), target = UUID.randomUUID();
        List<org.assertj.core.api.ThrowableAssert.ThrowingCallable> reads = List.of(
            () -> service.members(actor, "", "", 0, 25), () -> service.member(actor, target),
            () -> service.summary(actor), () -> service.logins(actor, null, 0, 25), () -> service.audits(actor, 0, 25),
            () -> service.usage(actor, target), () -> service.usageHistory(actor, target, null, 20));
        for (var read : reads) assertThatThrownBy(read).isInstanceOfSatisfying(ResponseStatusException.class,
            error -> assertThat(error.getStatusCode().value()).isEqualTo(403));
        verify(jdbc, times(7)).query(contains("g.capability='MEMBERS_READ'"), any(RowMapper.class), eq(actor));
        verifyNoMoreInteractions(jdbc);
        verifyNoInteractions(usage);
    }

    @Test void authorizedReadsValidateBoundsBeforeQueryingMembers() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        var usage = mock(PlatformUsageService.class);
        UUID actor = UUID.randomUUID();
        authorize(jdbc, actor);
        var service = new AdminMemberService(jdbc, usage);
        List<org.assertj.core.api.ThrowableAssert.ThrowingCallable> invalid = List.of(
            () -> service.members(actor, "x".repeat(101), "", 0, 25),
            () -> service.members(actor, "", "UNKNOWN", 0, 25),
            () -> service.members(actor, "", "", -1, 25),
            () -> service.logins(actor, null, 0, 101), () -> service.audits(actor, 100001, 25),
            () -> service.usageHistory(actor, actor, null, 0), () -> service.usageHistory(actor, actor, null, 101),
            () -> service.usageHistory(actor, actor, "x".repeat(257), 20));
        for (var read : invalid) assertThatThrownBy(read).isInstanceOfSatisfying(ResponseStatusException.class,
            error -> assertThat(error.getStatusCode().value()).isEqualTo(400));
        verify(jdbc, times(8)).query(contains("g.capability='MEMBERS_READ'"), any(RowMapper.class), eq(actor));
        verifyNoMoreInteractions(jdbc);
        verifyNoInteractions(usage);
    }

    @Test void ledgerReadsRequireAnExistingLockedTargetBeforeDelegating() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        var usage = mock(PlatformUsageService.class);
        UUID actor = UUID.randomUUID(), target = UUID.randomUUID();
        authorize(jdbc, actor);
        var service = new AdminMemberService(jdbc, usage);
        assertThatThrownBy(() -> service.usage(actor, target)).isInstanceOfSatisfying(ResponseStatusException.class,
            error -> assertThat(error.getStatusCode().value()).isEqualTo(404));
        assertThatThrownBy(() -> service.usageHistory(actor, target, null, 20)).isInstanceOfSatisfying(ResponseStatusException.class,
            error -> assertThat(error.getStatusCode().value()).isEqualTo(404));
        verifyNoInteractions(usage);
        when(jdbc.query(eq("SELECT id FROM app.user_account WHERE id=? FOR SHARE"),
            org.mockito.ArgumentMatchers.<RowMapper<UUID>>any(), eq(target))).thenReturn(List.of(target));
        clearInvocations(jdbc);
        var snapshot = mock(PlatformUsageService.Usage.class);
        var history = new PlatformUsageService.History(List.of(), "next-page");
        when(usage.snapshot(target)).thenReturn(snapshot);
        when(usage.history(target, "opaque-cursor", 25)).thenReturn(history);
        assertThat(service.usage(actor, target)).isSameAs(snapshot);
        assertThat(service.usageHistory(actor, target, "opaque-cursor", 25)).isSameAs(history);
        var order = inOrder(jdbc, usage);
        order.verify(jdbc).query(contains("FOR SHARE OF g,a"), any(RowMapper.class), eq(actor));
        order.verify(jdbc).query(contains("WHERE id=? FOR SHARE"), any(RowMapper.class), eq(target));
        order.verify(usage).snapshot(target);
        order.verify(jdbc).query(contains("FOR SHARE OF g,a"), any(RowMapper.class), eq(actor));
        order.verify(jdbc).query(contains("WHERE id=? FOR SHARE"), any(RowMapper.class), eq(target));
        order.verify(usage).history(target, "opaque-cursor", 25);
        order.verifyNoMoreInteractions();
    }

    @Test void ledgerReadsRecheckGrantAfterAnEarlierSuccessfulRead() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        var usage = mock(PlatformUsageService.class);
        UUID actor = UUID.randomUUID();
        when(jdbc.query(contains("g.capability='MEMBERS_READ'"), org.mockito.ArgumentMatchers.<RowMapper<UUID>>any(), eq(actor)))
            .thenReturn(List.of(actor), List.of());
        when(jdbc.query(contains("WHERE id=? FOR SHARE"), org.mockito.ArgumentMatchers.<RowMapper<UUID>>any(), eq(actor)))
            .thenReturn(List.of(actor));
        var service = new AdminMemberService(jdbc, usage);
        service.usage(actor, actor);
        assertThatThrownBy(() -> service.usageHistory(actor, actor, null, 20))
            .isInstanceOfSatisfying(ResponseStatusException.class, error -> assertThat(error.getStatusCode().value()).isEqualTo(403));
        verify(usage).snapshot(actor);
        verifyNoMoreInteractions(usage);
    }

    private void authorize(JdbcTemplate jdbc, UUID actor) {
        when(jdbc.query(contains("g.capability='MEMBERS_READ'"), org.mockito.ArgumentMatchers.<RowMapper<UUID>>any(), eq(actor)))
            .thenReturn(List.of(actor));
    }
}
