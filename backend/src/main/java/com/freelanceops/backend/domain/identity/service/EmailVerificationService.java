package com.freelanceops.backend.domain.identity.service;

import com.freelanceops.backend.domain.identity.dto.request.RegisterRequest;
import com.freelanceops.backend.domain.identity.dto.response.AuthTokenResponse;
import com.freelanceops.backend.domain.workspace.service.WorkspaceProvisioningService;
import com.freelanceops.backend.global.mail.OperationalMailTransport;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.sql.Date;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.Executor;
import java.util.concurrent.RejectedExecutionException;

@Service
public class EmailVerificationService {
    private final JdbcTemplate jdbc;
    private final PasswordEncoder passwords;
    private final WorkspaceProvisioningService workspaces;
    private final AuthTokenService tokens;
    private final OperationalMailTransport mail;
    private final Executor mailExecutor;
    private final boolean required;
    private final long ttlSeconds;
    private final long cooldownSeconds;
    private final int dailyLimit;
    private final String publicOrigin;
    private final SecureRandom random = new SecureRandom();

    public EmailVerificationService(
            JdbcTemplate jdbc,
            PasswordEncoder passwords,
            WorkspaceProvisioningService workspaces,
            AuthTokenService tokens,
            OperationalMailTransport mail,
            @Qualifier("verificationMailExecutor") Executor mailExecutor,
            @Value("${app.auth.email-verification.required:false}") boolean required,
            @Value("${app.auth.email-verification.ttl-seconds:1800}") long ttlSeconds,
            @Value("${app.auth.email-verification.cooldown-seconds:60}") long cooldownSeconds,
            @Value("${app.auth.email-verification.daily-limit:5}") int dailyLimit,
            @Value("${app.auth.email-verification.public-origin:http://localhost:3000}")
                    String publicOrigin) {
        if (ttlSeconds < 300
                || ttlSeconds > 86400
                || cooldownSeconds < 30
                || cooldownSeconds > ttlSeconds
                || dailyLimit < 1
                || dailyLimit > 20)
            throw new IllegalArgumentException("Invalid email verification limits");
        URI origin = URI.create(publicOrigin);
        if (origin.getHost() == null
                || origin.getUserInfo() != null
                || origin.getQuery() != null
                || origin.getFragment() != null
                || (origin.getPath() != null && !origin.getPath().isEmpty())
                || !("https".equals(origin.getScheme())
                        || ("http".equals(origin.getScheme())
                                && "localhost".equals(origin.getHost()))))
            throw new IllegalArgumentException(
                    "Email verification public origin must be an exact HTTPS origin (localhost HTTP is allowed)");
        this.jdbc = jdbc;
        this.passwords = passwords;
        this.workspaces = workspaces;
        this.tokens = tokens;
        this.mail = mail;
        this.mailExecutor = mailExecutor;
        this.required = required;
        this.ttlSeconds = ttlSeconds;
        this.cooldownSeconds = cooldownSeconds;
        this.dailyLimit = dailyLimit;
        this.publicOrigin = publicOrigin;
    }

    public boolean required() {
        return required;
    }

    @Transactional
    public AuthTokenResponse registerPending(RegisterRequest input) {
        if (!Boolean.TRUE.equals(input.ageAtLeast14()))
            throw new IdentityException(HttpStatus.BAD_REQUEST, "AGE_CONFIRMATION_REQUIRED");
        requireTransport();
        // 가입 여부가 처리 시간으로 드러나지 않도록 같은 비밀번호 연산을 수행한다.
        // 주소 인증 전의 비밀번호는 저장하거나 활성화하지 않는다.
        passwords.encode("verification-registration-timing-work");
        String email = normalize(input.email());
        UUID id = UUID.randomUUID();
        Instant now = tokens.now();
        int inserted =
                jdbc.update(
                        """
            INSERT INTO app.user_account (id, external_subject, email, display_name, password_hash, status,
                created_at, updated_at, version, email_verification_required)
            VALUES (?, ?, ?, ?, NULL, 'ACTIVE', ?, ?, 0, TRUE) ON CONFLICT DO NOTHING
            """,
                        id,
                        "local:" + id,
                        email,
                        input.displayName().trim(),
                        Timestamp.from(now),
                        Timestamp.from(now));
        if (inserted == 1) {
            workspaces.create(
                    id,
                    input.workspaceName().trim(),
                    "workspace-" + UUID.randomUUID().toString().substring(0, 12));
            request(email);
        }
        // 사용자·워크스페이스 식별자, 토큰, 가입 여부는 응답에 포함하지 않는다.
        return new AuthTokenResponse(
                null, null, null, null, null, null, "EmailVerificationRequired");
    }

    @Transactional
    public void request(String address) {
        requireTransport();
        String email = normalize(address);
        Instant now = tokens.now();
        Date day = Date.valueOf(now.atZone(ZoneOffset.UTC).toLocalDate());
        List<PendingAccount> accounts =
                jdbc.query(
                        """
            SELECT id, email, email_verification_requested_at, email_verification_day, email_verification_daily_count
            FROM app.user_account WHERE LOWER(email) = ? AND status = 'ACTIVE' AND email_verified_at IS NULL FOR UPDATE
            """,
                        (row, n) ->
                                new PendingAccount(
                                        row.getObject(1, UUID.class),
                                        row.getString(2),
                                        row.getTimestamp(3),
                                        row.getDate(4),
                                        row.getInt(5)),
                        email);
        if (accounts.isEmpty()) return;
        PendingAccount account = accounts.getFirst();
        int count = day.equals(account.day()) ? account.count() : 0;
        if ((account.lastRequest() != null
                        && account.lastRequest()
                                .toInstant()
                                .plusSeconds(cooldownSeconds)
                                .isAfter(now))
                || count >= dailyLimit) return;
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        String rawToken = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        String tokenHash = digest(rawToken);
        jdbc.update(
                """
            UPDATE app.user_account SET email_verification_token_hash = ?, email_verification_expires_at = ?,
            email_verification_requested_at = ?, email_verification_day = ?, email_verification_daily_count = ?,
            updated_at = ?, version = version + 1 WHERE id = ?
            """,
                tokenHash,
                Timestamp.from(now.plusSeconds(ttlSeconds)),
                Timestamp.from(now),
                day,
                count + 1,
                Timestamp.from(now),
                account.id());
        // 인증 링크는 메일 전송에만 전달하고 저장하거나 응답으로 반환하지 않는다.
        Runnable deliver =
                () -> {
                    try {
                        mail.send(
                                "verify:" + tokenHash,
                                account.email(),
                                "Freelance Ops 이메일 확인",
                                "이메일 주소를 확인하려면 다음 링크를 열어 확인 버튼을 눌러 주세요.\n"
                                        + publicOrigin
                                        + "/verify-email#token="
                                        + rawToken
                                        + "\n요청하지 않았다면 무시하세요. 이 링크는 한 번만 사용할 수 있으며 "
                                        + (ttlSeconds / 60)
                                        + "분 뒤 만료됩니다.");
                    } catch (RuntimeException ignored) {
                        // 제공사 예외에 토큰·수신자·요청 본문이 포함될 수 있어 기록하지 않는다. 재전송은 대기 시간이 지난 뒤 사용자가 다시 요청해야
                        // 한다.
                    }
                };
        Runnable enqueue =
                () -> {
                    try {
                        mailExecutor.execute(deliver);
                    } catch (RejectedExecutionException ignored) {
                        /* 전송 대기열이 가득 차면 인증 대상 여부를 노출하지 않고 요청을 마친다. */
                    }
                };
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(
                    new TransactionSynchronization() {
                        @Override
                        public void afterCommit() {
                            enqueue.run();
                        }
                    });
        } else enqueue.run();
    }

    @Transactional
    public void confirm(String rawToken, String password) {
        if (rawToken == null || !rawToken.matches("[A-Za-z0-9_-]{43}")) throw invalidToken();
        if (password == null
                || password.length() < 12
                || password.length() > 72
                || password.getBytes(StandardCharsets.UTF_8).length > 72)
            throw new IdentityException(HttpStatus.BAD_REQUEST, "INVALID_VERIFICATION_PASSWORD");
        String passwordHash = passwords.encode(password);
        Instant now = tokens.now();
        int updated =
                jdbc.update(
                        """
            UPDATE app.user_account SET email_verified_at = ?,
                password_hash = CASE WHEN email_verification_required THEN ? ELSE password_hash END, email_verification_required = FALSE,
                email_verification_token_hash = NULL, email_verification_expires_at = NULL, updated_at = ?, version = version + 1
            WHERE email_verification_token_hash = ? AND email_verification_expires_at > ? AND status = 'ACTIVE'
                AND email_verified_at IS NULL
            """,
                        Timestamp.from(now),
                        passwordHash,
                        Timestamp.from(now),
                        digest(rawToken),
                        Timestamp.from(now));
        if (updated != 1) throw invalidToken();
    }

    private void requireTransport() {
        if (!mail.ready())
            throw new IdentityException(
                    HttpStatus.SERVICE_UNAVAILABLE, "EMAIL_VERIFICATION_UNAVAILABLE");
    }

    private static IdentityException invalidToken() {
        return new IdentityException(HttpStatus.BAD_REQUEST, "INVALID_OR_EXPIRED_VERIFICATION");
    }

    public static String normalize(String email) {
        return email.trim().toLowerCase(Locale.ROOT);
    }

    static String digest(String token) {
        try {
            return HexFormat.of()
                    .formatHex(
                            MessageDigest.getInstance("SHA-256")
                                    .digest(token.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException error) {
            throw new IllegalStateException("SHA-256 unavailable", error);
        }
    }

    private record PendingAccount(
            UUID id, String email, Timestamp lastRequest, Date day, int count) {}
}
