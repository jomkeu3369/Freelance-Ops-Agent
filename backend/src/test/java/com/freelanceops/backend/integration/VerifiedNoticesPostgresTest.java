package com.freelanceops.backend.integration;

import com.freelanceops.backend.domain.identity.dto.request.RegisterRequest;
import com.freelanceops.backend.domain.identity.dto.request.LoginRequest;
import com.freelanceops.backend.domain.identity.service.AuthService;
import com.freelanceops.backend.domain.identity.service.EmailVerificationService;
import com.freelanceops.backend.domain.identity.service.IdentityException;
import com.freelanceops.backend.domain.notice.service.NoticeService;
import com.freelanceops.backend.global.mail.OperationalMailTransport;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.server.ResponseStatusException;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import static org.assertj.core.api.Assertions.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** Disposable PostgreSQL + in-memory transport only. No network email or real address is used. */
@Testcontainers(disabledWithoutDocker = true)
@SpringBootTest(properties = {"app.environment=test", "spring.flyway.create-schemas=true", "app.auth.email-verification.required=true",
    "app.notices.dispatch-enabled=true", "agent.command-dispatch-enabled=false", "agent.reconciliation-enabled=false", "app.rate-limit.enabled=false"})
@AutoConfigureMockMvc
@Import(VerifiedNoticesPostgresTest.MailFixture.class)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
@Timeout(60)
class VerifiedNoticesPostgresTest {
    @Container static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer(
        DockerImageName.parse("pgvector/pgvector:pg17").asCompatibleSubstituteFor("postgres"));
    @DynamicPropertySource static void datasource(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }
    @TestConfiguration static class MailFixture {
        @Bean @Primary FakeMail fakeMail() { return new FakeMail(); }
    }
    static final class FakeMail implements OperationalMailTransport {
        volatile boolean ready = true;
        volatile Result result = Result.ACCEPTED;
        volatile CountDownLatch entered;
        volatile CountDownLatch release;
        final Map<String,Message> messages = new ConcurrentHashMap<>();
        public boolean ready() { return ready; }
        public Result send(String key,String recipient,String subject,String body) {
            if (!ready) return Result.BLOCKED_TRANSPORT;
            CountDownLatch currentEntered=entered, currentRelease=release;
            if (currentEntered!=null) currentEntered.countDown();
            if (currentRelease!=null) {
                try { if(!currentRelease.await(10,TimeUnit.SECONDS)) return Result.UNKNOWN; }
                catch(InterruptedException error) { Thread.currentThread().interrupt(); return Result.UNKNOWN; }
            }
            if (result == Result.ACCEPTED) messages.putIfAbsent(key,new Message(recipient,subject,body));
            return result;
        }
        String latestToken(String recipient) {
            long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(5);
            while (messages.values().stream().noneMatch(m -> m.recipient().equals(recipient) && m.body().contains("#token="))) {
                if(System.nanoTime()>deadline) throw new AssertionError("Synthetic verification mail was not queued");
                try { Thread.sleep(10); } catch(InterruptedException error) { Thread.currentThread().interrupt(); throw new AssertionError(error); }
            }
            return messages.values().stream().filter(m -> m.recipient().equals(recipient) && m.body().contains("#token="))
                .map(m -> m.body().split("#token=")[1].split("\n")[0]).reduce((first,second) -> second).orElseThrow();
        }
        void reset() { ready=true; result=Result.ACCEPTED; entered=null; release=null; messages.clear(); }
    }
    record Message(String recipient,String subject,String body) {
        @Override public String toString() { return "[redacted synthetic mail]"; }
    }
    @Autowired AuthService auth;
    @Autowired EmailVerificationService verification;
    @Autowired NoticeService notices;
    @Autowired JdbcTemplate jdbc;
    @Autowired MockMvc mvc;
    @Autowired FakeMail mail;
    @Autowired org.springframework.transaction.PlatformTransactionManager transactionManager;
    UUID admin;
    @BeforeEach void setup() {
        jdbc.execute("TRUNCATE TABLE app.notice_admin_audit,app.notice_delivery,app.notice_campaign,app.service_notice,app.user_account CASCADE");
        mail.reset();
        admin=account(true);
        jdbc.update("INSERT INTO app.platform_admin_grant(user_id,capability) VALUES (?,'NOTICES_ADMIN')",admin);
    }
    @Test void signupRequiresOwnershipAndDuplicateRegistrationRevealsNoAccountOrSession() {
        RegisterRequest input=registration("new@example.invalid");
        var pending=auth.register(input);
        assertThat(pending.tokenType()).isEqualTo("EmailVerificationRequired");
        assertThat(pending.accessToken()).isNull(); assertThat(pending.refreshToken()).isNull(); assertThat(pending.userId()).isNull();
        assertThat(auth.register(input)).isEqualTo(pending);
        assertThatThrownBy(() -> auth.login(new LoginRequest(input.email(),input.password()))).isInstanceOf(IdentityException.class);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM app.refresh_token",Integer.class)).isZero();
        String raw=mail.latestToken(input.email());
        assertThat(jdbc.queryForObject("SELECT email_verification_token_hash FROM app.user_account WHERE email=?",String.class,input.email())).hasSize(64).isNotEqualTo(raw);
        verification.confirm(raw,"ownership-confirmed-password");
        assertThat(auth.login(new LoginRequest(input.email(),"ownership-confirmed-password")).accessToken()).isNotBlank();
        assertThatThrownBy(() -> auth.login(new LoginRequest(input.email(),input.password()))).isInstanceOf(IdentityException.class);
        assertThatThrownBy(() -> verification.confirm(raw,"ownership-confirmed-password")).isInstanceOf(IdentityException.class);
    }
    @Test void expiryAndResendInvalidateOldTokenAndCooldownSuppressesDuplicates() {
        String email="resend@example.invalid"; auth.register(registration(email));
        String first=mail.latestToken(email);
        verification.request(email.toUpperCase(Locale.ROOT));
        assertThat(mail.messages).hasSize(1);
        jdbc.update("UPDATE app.user_account SET email_verification_expires_at=? WHERE email=?",Timestamp.from(Instant.now().minusSeconds(1)),email);
        assertThatThrownBy(() -> verification.confirm(first,"ownership-confirmed-password")).isInstanceOf(IdentityException.class);
        jdbc.update("UPDATE app.user_account SET email_verification_requested_at=? WHERE email=?",Timestamp.from(Instant.now().minusSeconds(120)),email);
        mail.messages.clear(); verification.request("  " + email + "  ");
        String second=mail.latestToken(email); assertThat(second).isNotEqualTo(first);
        assertThatThrownBy(() -> verification.confirm(first,"ownership-confirmed-password")).isInstanceOf(IdentityException.class);
        verification.confirm(second,"ownership-confirmed-password");
        assertThatThrownBy(() -> verification.confirm(second,"ownership-confirmed-password")).isInstanceOf(IdentityException.class);
    }
    @Test void disabledTransportFailsBeforeCreatingAnUnreachableAccount() {
        mail.ready=false;
        assertThatThrownBy(() -> auth.register(registration("blocked@example.invalid")))
            .isInstanceOfSatisfying(IdentityException.class,e -> assertThat(e.status().value()).isEqualTo(503));
        assertThat(jdbc.queryForObject("SELECT count(*) FROM app.user_account WHERE email='blocked@example.invalid'",Integer.class)).isZero();
        assertThat(mail.messages).isEmpty();
    }
    @Test void dailyResendLimitAndUnknownEmailHaveSameGenericResponse() throws Exception {
        String email="limited@example.invalid"; auth.register(registration(email)); mail.latestToken(email);
        jdbc.update("UPDATE app.user_account SET email_verification_daily_count=5,email_verification_requested_at=? WHERE email=?",Timestamp.from(Instant.now().minusSeconds(120)),email);
        mvc.perform(post("/api/v2/auth/email-verification/request").contentType("application/json").content("{\"email\":\""+email+"\"}"))
            .andExpect(status().isAccepted()).andExpect(jsonPath("$.status").value("IF_ELIGIBLE_CHECK_EMAIL"));
        mvc.perform(post("/api/v2/auth/email-verification/request").contentType("application/json").content("{\"email\":\"absent@example.invalid\"}"))
            .andExpect(status().isAccepted()).andExpect(jsonPath("$.status").value("IF_ELIGIBLE_CHECK_EMAIL"));
        assertThat(mail.messages).hasSize(1);
    }
    @Test void tokenIsSingleUseEvenUnderConcurrentConfirmation() throws Exception {
        String email="race@example.invalid"; auth.register(registration(email)); String token=mail.latestToken(email);
        try(var pool=Executors.newVirtualThreadPerTaskExecutor()) {
            List<Future<Boolean>> attempts=new ArrayList<>();
            for(int i=0;i<8;i++) attempts.add(pool.submit(() -> { try { verification.confirm(token,"ownership-confirmed-password"); return true; } catch(IdentityException expected) { return false; } }));
            int success=0; for(var attempt:attempts) if(attempt.get()) success++;
            assertThat(success).isOne();
        }
    }
    @Test void legacyAccountsRemainUnverifiedAndAreExcludedFromAudience() {
        UUID legacy=account(false);
        assertThat(jdbc.queryForObject("SELECT email_verification_required FROM app.user_account WHERE id=?",Boolean.class,legacy)).isFalse();
        assertThat(jdbc.queryForObject("SELECT email_verified_at FROM app.user_account WHERE id=?",Timestamp.class,legacy)).isNull();
        var campaign=notices.prepare(admin,published().id());
        assertThat(campaign.recipientCount()).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM app.notice_delivery WHERE user_id=?",Integer.class,legacy)).isZero();
    }
    @Test void anonymousWorkspaceRolesAndQuotaAdminCannotManageNotices() throws Exception {
        mvc.perform(get("/api/v2/admin/notices")).andExpect(status().isUnauthorized());
        UUID other=account(true); jdbc.update("INSERT INTO app.platform_admin_grant(user_id,capability) VALUES (?,'FREE_USAGE_ADMIN')",other);
        mvc.perform(get("/api/v2/admin/notices").with(jwt().jwt(j -> j.subject(other.toString()))
            .authorities(new SimpleGrantedAuthority("ROLE_OWNER"),new SimpleGrantedAuthority("ROLE_ADMIN"))))
            .andExpect(status().isForbidden());
        assertThatThrownBy(() -> notices.create(other,"OPERATIONAL","title","body","v1",Instant.now())).isInstanceOf(ResponseStatusException.class);
    }
    @Test void draftFutureAndLegalMetadataNeverLeakThroughPublicEndpoint() throws Exception {
        var legal=notices.create(admin,"TERMS_VERSION","Synthetic version metadata","","legal-1",Instant.now().plusSeconds(7200));
        var reviewed=notices.review(admin,legal.id(),0);
        assertThatThrownBy(() -> notices.publish(admin,legal.id(),reviewed.revision(),Instant.now(),"PUBLISH_NOTICE")).isInstanceOf(ResponseStatusException.class);
        assertThatThrownBy(() -> notices.create(admin,"PRIVACY_VERSION","metadata","private draft forbidden","privacy-1",Instant.now())).isInstanceOf(ResponseStatusException.class);
        var future=notices.create(admin,"OPERATIONAL","Synthetic future notice","Test only","future-1",Instant.now().plusSeconds(7200));
        notices.review(admin,future.id(),0); notices.publish(admin,future.id(),1,Instant.now().plusSeconds(3600),"PUBLISH_NOTICE");
        notices.create(admin,"OPERATIONAL","Synthetic draft","Draft only","draft-1",Instant.now().plusSeconds(3600));
        mvc.perform(get("/api/v2/notices")).andExpect(status().isOk()).andExpect(content().json("[]"));
        var current=published(); assertThat(notices.published()).extracting(NoticeService.Notice::id).containsExactly(current.id());
    }
    @Test void publishedContentAndCampaignAudienceAreImmutableAndConfirmationIsIdempotent() {
        var notice=published(); var campaign=notices.prepare(admin,notice.id());
        assertThatThrownBy(() -> jdbc.update("UPDATE app.service_notice SET body='tampered' WHERE id=?",notice.id())).isInstanceOf(org.springframework.dao.DataAccessException.class);
        assertThatThrownBy(() -> jdbc.update("UPDATE app.notice_campaign SET snapshot_body='tampered' WHERE id=?",campaign.id())).isInstanceOf(org.springframework.dao.DataAccessException.class);
        assertThatThrownBy(() -> jdbc.update("UPDATE app.notice_delivery SET recipient_email='other@example.invalid' WHERE campaign_id=?",campaign.id())).isInstanceOf(org.springframework.dao.DataAccessException.class);
        notices.test(admin,campaign.id());
        assertThatThrownBy(() -> notices.confirm(admin,campaign.id(),"0".repeat(64),campaign.recipientHash(),campaign.recipientCount(),"QUEUE_OPERATIONAL_NOTICE"))
            .isInstanceOf(ResponseStatusException.class);
        var first=confirm(campaign); var second=confirm(campaign);
        assertThat(first.status()).isEqualTo("QUEUED"); assertThat(second.deliveries()).isEqualTo(first.deliveries());
        assertThat(jdbc.queryForObject("SELECT count(*) FROM app.notice_admin_audit WHERE campaign_id=? AND action='CONFIRM_QUEUE'",Integer.class,campaign.id())).isOne();
    }
    @Test void selfTestUsesOnlyVerifiedActingAdminAndBlockedTestNeverAuthorizesQueue() {
        account(true); var campaign=notices.prepare(admin,published().id());
        mail.ready=false; assertThat(notices.test(admin,campaign.id()).testStatus()).isEqualTo("BLOCKED_TRANSPORT");
        assertThatThrownBy(() -> confirm(campaign)).isInstanceOf(ResponseStatusException.class);
        assertThat(mail.messages).isEmpty();
        var fresh=notices.prepare(admin,campaign.noticeId()); mail.ready=true; notices.test(admin,fresh.id());
        String own=jdbc.queryForObject("SELECT email FROM app.user_account WHERE id=?",String.class,admin);
        assertThat(mail.messages.values()).extracting(Message::recipient).containsExactly(own);
    }
    @Test void disabledDispatchCancellationAndRepeatDispatchNeverDuplicateMail() {
        var campaign=notices.prepare(admin,published().id()); notices.test(admin,campaign.id()); confirm(campaign); mail.messages.clear();
        mail.ready=false; assertThat(notices.dispatchNext(admin,campaign.id()).status()).isEqualTo("BLOCKED_TRANSPORT");
        assertThat(mail.messages).isEmpty(); mail.ready=true;
        assertThat(notices.dispatchNext(admin,campaign.id()).status()).isEqualTo("ACCEPTED");
        notices.dispatchNext(admin,campaign.id()); assertThat(mail.messages).hasSize(1);
        var cancelled=notices.prepare(admin,campaign.noticeId()); notices.test(admin,cancelled.id()); confirm(cancelled); mail.messages.clear();
        notices.cancel(admin,cancelled.id()); assertThat(notices.dispatchNext(admin,cancelled.id()).status()).isEqualTo("CANCELLED");
        assertThat(mail.messages).isEmpty();
    }
    @Test void changedEligibilitySuppressesDeliveryAndUnknownResultIsNeverAutomaticallyRetried() {
        UUID other=account(true); var campaign=notices.prepare(admin,published().id()); notices.test(admin,campaign.id()); confirm(campaign);
        jdbc.update("UPDATE app.user_account SET status='DISABLED' WHERE id=?",other);
        mail.result=OperationalMailTransport.Result.UNKNOWN;
        notices.dispatchNext(admin,campaign.id()); notices.dispatchNext(admin,campaign.id()); notices.dispatchNext(admin,campaign.id());
        assertThat(jdbc.queryForObject("SELECT count(*) FROM app.notice_delivery WHERE campaign_id=? AND status='UNKNOWN'",Integer.class,campaign.id())).isOne();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM app.notice_delivery WHERE campaign_id=? AND status='SUPPRESSED'",Integer.class,campaign.id())).isOne();
        assertThat(jdbc.queryForObject("SELECT SUM(attempts) FROM app.notice_delivery WHERE campaign_id=?",Integer.class,campaign.id())).isOne();
    }
    @Test void preregistrationCannotChooseTheOwnersActivatedPassword() {
        String email="victim@example.invalid";
        auth.register(new RegisterRequest(email,"attacker-password-only","Unverified preregistration","Pending workspace",true));
        mail.latestToken(email);
        assertThat(jdbc.queryForObject("SELECT password_hash FROM app.user_account WHERE email=?",String.class,email)).isNull();
        auth.register(new RegisterRequest(email,"victim-signup-password","Owner","Owner workspace",true));
        jdbc.update("UPDATE app.user_account SET email_verification_requested_at=? WHERE email=?",Timestamp.from(Instant.now().minusSeconds(120)),email);
        mail.messages.clear(); verification.request(email);
        verification.confirm(mail.latestToken(email),"owner-confirmed-password");
        assertThat(auth.login(new LoginRequest(email,"owner-confirmed-password")).accessToken()).isNotBlank();
        assertThatThrownBy(() -> auth.login(new LoginRequest(email,"attacker-password-only"))).isInstanceOf(IdentityException.class);
        assertThatThrownBy(() -> auth.login(new LoginRequest(email,"victim-signup-password"))).isInstanceOf(IdentityException.class);
    }
    @Test void legacyOwnershipConfirmationPreservesExistingPasswordAndNullCredentialNeverAuthenticates() {
        UUID legacy=account(false);
        String email=jdbc.queryForObject("SELECT email FROM app.user_account WHERE id=?",String.class,legacy);
        String existingHash=new org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder(4).encode("existing-legacy-password");
        jdbc.update("UPDATE app.user_account SET password_hash=? WHERE id=?",existingHash,legacy);
        verification.request(email); verification.confirm(mail.latestToken(email),"unused-confirmation-password");
        assertThat(jdbc.queryForObject("SELECT password_hash FROM app.user_account WHERE id=?",String.class,legacy)).isEqualTo(existingHash);
        assertThat(auth.login(new LoginRequest(email,"existing-legacy-password")).accessToken()).isNotBlank();
        UUID external=account(false);
        String externalEmail=jdbc.queryForObject("SELECT email FROM app.user_account WHERE id=?",String.class,external);
        assertThatThrownBy(() -> auth.login(new LoginRequest(externalEmail,"timing-only-password-value"))).isInstanceOf(IdentityException.class);
    }
    @Test void verificationErrorsHaveStableHttpStatusAndDoNotLeakTokens() throws Exception {
        mvc.perform(post("/api/v2/auth/email-verification/confirm").contentType("application/json")
            .content("{\"token\":\"invalid\",\"password\":\"synthetic-password-only\"}"))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_OR_EXPIRED_VERIFICATION"));
        String email="expired-http@example.invalid"; auth.register(registration(email)); String token=mail.latestToken(email);
        jdbc.update("UPDATE app.user_account SET email_verification_expires_at=? WHERE email=?",Timestamp.from(Instant.now().minusSeconds(1)),email);
        String body="{\"token\":\""+token+"\",\"password\":\"synthetic-password-only\"}";
        mvc.perform(post("/api/v2/auth/email-verification/confirm").contentType("application/json").content(body))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_OR_EXPIRED_VERIFICATION"));
        mail.ready=false;
        mvc.perform(post("/api/v2/auth/email-verification/request").contentType("application/json").content("{\"email\":\"absent@example.invalid\"}"))
            .andExpect(status().isServiceUnavailable()).andExpect(jsonPath("$.code").value("EMAIL_VERIFICATION_UNAVAILABLE"));
    }
    @Test void validationResponsesNeverEchoVerificationSecrets() throws Exception {
        String oversized="synthetic-token-".repeat(20);
        mvc.perform(post("/api/v2/auth/email-verification/confirm").contentType("application/json")
            .content("{\"token\":\""+oversized+"\",\"password\":\"synthetic-password-only\"}"))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_IDENTITY_REQUEST"))
            .andExpect(content().string(org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString(oversized))));
    }
    @Test void eligibleResendDoesNotWaitForProviderLatency() throws Exception {
        UUID legacy=account(false);
        String email=jdbc.queryForObject("SELECT email FROM app.user_account WHERE id=?",String.class,legacy);
        mail.entered=new CountDownLatch(1); mail.release=new CountDownLatch(1);
        try(var pool=Executors.newVirtualThreadPerTaskExecutor()) {
            try {
                pool.submit(() -> verification.request(email)).get(2,TimeUnit.SECONDS);
                assertThat(mail.entered.await(2,TimeUnit.SECONDS)).isTrue();
                pool.submit(() -> verification.request("absent@example.invalid")).get(2,TimeUnit.SECONDS);
                assertThat(mail.messages).isEmpty();
            } finally { mail.release.countDown(); }
        }
        mail.latestToken(email);
    }
    @Test void independentDispatchFlagBlocksEvenAReadyAcceptedTransport() {
        var campaign=notices.prepare(admin,published().id()); notices.test(admin,campaign.id()); confirm(campaign); mail.messages.clear();
        var flagOff=new NoticeService(jdbc,mail,200,false);
        var outcome=new org.springframework.transaction.support.TransactionTemplate(transactionManager)
            .execute(status -> flagOff.dispatchNext(admin,campaign.id()));
        assertThat(outcome.status()).isEqualTo("BLOCKED_TRANSPORT");
        assertThat(outcome.processed()).isZero();
        assertThat(mail.messages).isEmpty();
        assertThat(jdbc.queryForObject("SELECT attempts FROM app.notice_delivery WHERE campaign_id=?",Integer.class,campaign.id())).isZero();
    }
    @Test void retryableFailuresBackOffAndStopAfterThreeAttempts() {
        var campaign=notices.prepare(admin,published().id()); notices.test(admin,campaign.id()); confirm(campaign); mail.messages.clear();
        mail.result=OperationalMailTransport.Result.RETRYABLE_FAILED;
        assertThat(notices.dispatchNext(admin,campaign.id()).status()).isEqualTo("RETRY");
        assertThat(notices.dispatchNext(admin,campaign.id()).processed()).isZero();
        for(int i=0;i<2;i++) {
            jdbc.update("UPDATE app.notice_delivery SET next_attempt_at=? WHERE campaign_id=?",Timestamp.from(Instant.now().minusSeconds(1)),campaign.id());
            notices.dispatchNext(admin,campaign.id());
        }
        assertThat(jdbc.queryForObject("SELECT status FROM app.notice_delivery WHERE campaign_id=?",String.class,campaign.id())).isEqualTo("FAILED");
        assertThat(jdbc.queryForObject("SELECT attempts FROM app.notice_delivery WHERE campaign_id=?",Integer.class,campaign.id())).isEqualTo(3);
        assertThat(notices.dispatchNext(admin,campaign.id()).status()).isEqualTo("COMPLETED");
    }
    private NoticeService.Campaign confirm(NoticeService.Campaign c) { return notices.confirm(admin,c.id(),c.contentHash(),c.recipientHash(),c.recipientCount(),"QUEUE_OPERATIONAL_NOTICE"); }
    private NoticeService.Notice published() {
        var draft=notices.create(admin,"OPERATIONAL","Synthetic service notice","Disposable test content",UUID.randomUUID().toString(),Instant.now().plusSeconds(3600));
        notices.review(admin,draft.id(),0); return notices.publish(admin,draft.id(),1,Instant.now(),"PUBLISH_NOTICE");
    }
    private UUID account(boolean verified) {
        UUID id=UUID.randomUUID();
        jdbc.update("INSERT INTO app.user_account(id,external_subject,email,status,email_verified_at) VALUES (?,?,?,'ACTIVE',?)",
            id,"fixture:"+id,id+"@example.invalid",verified?Timestamp.from(Instant.now()):null);
        return id;
    }
    private static RegisterRequest registration(String email) { return new RegisterRequest(email,"synthetic-password-only","Fixture","Fixture workspace",true); }
}
