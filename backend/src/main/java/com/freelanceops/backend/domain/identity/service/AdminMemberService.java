package com.freelanceops.backend.domain.identity.service;

import com.freelanceops.backend.domain.agentrun.dto.response.PlatformUsageHistoryResponse;
import com.freelanceops.backend.domain.agentrun.dto.response.PlatformUsageResponse;
import com.freelanceops.backend.domain.agentrun.service.PlatformUsageService;
import com.freelanceops.backend.domain.identity.dto.response.AdminMemberAuditResponse;
import com.freelanceops.backend.domain.identity.dto.response.AdminMemberLoginResponse;
import com.freelanceops.backend.domain.identity.dto.response.AdminMemberResponse;
import com.freelanceops.backend.domain.identity.dto.response.AdminMemberSummaryResponse;
import com.freelanceops.backend.domain.identity.dto.response.Page;
import com.freelanceops.backend.domain.identity.repository.JdbcAdminMemberRepository;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.Set;
import java.util.UUID;

/** 플랫폼 운영 메타데이터만 조회한다. 워크스페이스 내용 조회나 계정 변경은 담당하지 않는다. */
@Service
public class AdminMemberService {
    private final JdbcAdminMemberRepository repository;
    private final PlatformUsageService usage;

    public AdminMemberService(JdbcAdminMemberRepository repository, PlatformUsageService usage) {
        this.repository = repository;
        this.usage = usage;
    }

    @Transactional
    public Page<AdminMemberResponse> members(
            UUID actor, String query, String status, int page, int size) {
        requireAdmin(actor);
        validatePage(page, size);
        String q = query == null ? "" : query.strip();
        if (q.length() > 100) throw badRequest("Search is limited to 100 characters");
        String filter = status == null ? "" : status;
        if (!Set.of("", "ACTIVE", "DISABLED", "PENDING_VERIFICATION").contains(filter))
            throw badRequest("Unsupported account status");
        long total = repository.countMembers(q, filter);
        var items = repository.listMembers(q, filter, page, size);
        return new Page<>(items, total, page, size, recordingStartedAt());
    }

    @Transactional
    public AdminMemberResponse member(UUID actor, UUID userId) {
        requireAdmin(actor);
        return repository.findMember(userId).stream()
                .findFirst()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
    }

    @Transactional
    public PlatformUsageResponse usage(UUID actor, UUID userId) {
        requireAdmin(actor);
        requireMember(userId);
        return usage.snapshot(userId);
    }

    @Transactional
    public PlatformUsageHistoryResponse usageHistory(
            UUID actor, UUID userId, String cursor, int limit) {
        requireAdmin(actor);
        if (limit < 1 || limit > 100 || (cursor != null && cursor.length() > 256))
            throw badRequest("Invalid usage limit or cursor");
        requireMember(userId);
        return usage.history(userId, cursor, limit);
    }

    // 비활성·미인증 계정도 감사 대상으로 조회할 수 있다. 요청한 관리자는 활성·인증 상태여야 하며 대상 계정을 잠가 삭제와 원장 조회의 경합을 막는다.
    private void requireMember(UUID userId) {
        if (repository.lockMember(userId).isEmpty())
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
    }

    @Transactional
    public AdminMemberSummaryResponse summary(UUID actor) {
        requireAdmin(actor);
        return repository.readSummary();
    }

    @Transactional
    public Page<AdminMemberLoginResponse> logins(UUID actor, UUID userId, int page, int size) {
        requireAdmin(actor);
        validatePage(page, size);
        long total = repository.countLogins(userId);
        var rows = repository.listLogins(userId, page, size);
        return new Page<>(rows, total, page, size, recordingStartedAt());
    }

    @Transactional
    public Page<AdminMemberAuditResponse> audits(UUID actor, int page, int size) {
        requireAdmin(actor);
        validatePage(page, size);
        long total = repository.countAudits();
        var rows = repository.listAudits(size, (long) page * size);
        return new Page<>(rows, total, page, size, null);
    }

    // 호출마다 현재 권한과 계정 상태를 확인한다. 트랜잭션이 끝날 때까지 잠가 권한 철회와 조회가 경합하지 않도록 한다.
    private void requireAdmin(UUID actor) {
        var granted = repository.findAdminGrant(actor);
        if (granted.isEmpty())
            throw new ResponseStatusException(
                    HttpStatus.FORBIDDEN, "Member administration capability required");
    }

    private Instant recordingStartedAt() {
        return repository.recordingStartedAt();
    }

    private static void validatePage(int page, int size) {
        if (page < 0 || page > 100000 || size < 1 || size > 100)
            throw badRequest("Invalid page or size");
    }

    private static ResponseStatusException badRequest(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }
}
