package com.freelanceops.backend.domain.identity.service;

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
    @Test void everyEntryPointDeniesBeforeReadingMetadata() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        var service = new AdminMemberService(jdbc);
        UUID actor = UUID.randomUUID();
        List<org.assertj.core.api.ThrowableAssert.ThrowingCallable> reads = List.of(
            () -> service.members(actor, "", "", 0, 25), () -> service.member(actor, UUID.randomUUID()),
            () -> service.summary(actor), () -> service.logins(actor, null, 0, 25), () -> service.audits(actor, 0, 25));
        for (var read : reads) assertThatThrownBy(read).isInstanceOfSatisfying(ResponseStatusException.class,
            error -> assertThat(error.getStatusCode().value()).isEqualTo(403));
        verify(jdbc, times(5)).query(contains("g.capability='MEMBERS_READ'"), any(RowMapper.class), eq(actor));
        verifyNoMoreInteractions(jdbc);
    }

    @Test void authorizedReadsValidateBoundsBeforeQueryingMembers() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        UUID actor = UUID.randomUUID();
        when(jdbc.query(contains("g.capability='MEMBERS_READ'"), org.mockito.ArgumentMatchers.<RowMapper<UUID>>any(), eq(actor)))
            .thenReturn(List.of(actor));
        var service = new AdminMemberService(jdbc);
        List<org.assertj.core.api.ThrowableAssert.ThrowingCallable> invalid = List.of(
            () -> service.members(actor, "x".repeat(101), "", 0, 25),
            () -> service.members(actor, "", "UNKNOWN", 0, 25),
            () -> service.members(actor, "", "", -1, 25),
            () -> service.logins(actor, null, 0, 101), () -> service.audits(actor, 100001, 25));
        for (var read : invalid) assertThatThrownBy(read).isInstanceOfSatisfying(ResponseStatusException.class,
            error -> assertThat(error.getStatusCode().value()).isEqualTo(400));
        verify(jdbc, times(5)).query(contains("g.capability='MEMBERS_READ'"), any(RowMapper.class), eq(actor));
        verifyNoMoreInteractions(jdbc);
    }
}
