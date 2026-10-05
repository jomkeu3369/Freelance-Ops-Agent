package com.freelanceops.backend.integration;

import com.freelanceops.backend.domain.identity.service.AdminMemberService;
import com.freelanceops.backend.domain.identity.service.LoginActivityService;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** Synthetic accounts only; no production database, email delivery, or provider calls. */
@Testcontainers(disabledWithoutDocker = true)
@SpringBootTest(properties = {"app.environment=test", "agent.command-dispatch-enabled=false", "agent.reconciliation-enabled=false"})
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class AdminMemberPostgresTest {
    @Container static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer(
        DockerImageName.parse("pgvector/pgvector:pg17").asCompatibleSubstituteFor("postgres"));
    @DynamicPropertySource static void datasource(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired AdminMemberService service;
    @Autowired LoginActivityService activity;
    @Autowired PlatformTransactionManager transactions;
    UUID admin;
    @BeforeEach void setup() {
        admin = account("admin-" + UUID.randomUUID());
        jdbc.update("INSERT INTO app.platform_admin_grant(user_id,capability) VALUES (?,'MEMBERS_READ')", admin);
    }

    @Test void everyReadRejectsAnonymousWorkspaceRolesAndOtherPlatformCapabilities() throws Exception {
        UUID member = account("ordinary-" + UUID.randomUUID());
        jdbc.update("INSERT INTO app.platform_admin_grant(user_id,capability) VALUES (?,'FREE_USAGE_ADMIN')", member);
        for (String path : new String[]{"/members", "/members/summary", "/members/" + member, "/login-events", "/member-audit-events"}) {
            mvc.perform(get("/api/v2/admin" + path)).andExpect(status().isUnauthorized());
            mvc.perform(get("/api/v2/admin" + path).with(jwt().jwt(j -> j.subject(member.toString()))
                .authorities(new SimpleGrantedAuthority("ROLE_ADMIN"), new SimpleGrantedAuthority("ROLE_OWNER"))))
                .andExpect(status().isForbidden());
        }
    }

    @Test void readsRecheckRevocationInactiveAndUnverifiedAccounts() {
        assertThat(service.member(admin, admin).id()).isEqualTo(admin);
        jdbc.update("UPDATE app.platform_admin_grant SET revoked_at=CURRENT_TIMESTAMP WHERE user_id=?", admin);
        forbidden(() -> service.member(admin, admin));
        jdbc.update("UPDATE app.platform_admin_grant SET revoked_at=NULL WHERE user_id=?", admin);
        jdbc.update("UPDATE app.user_account SET status='DISABLED' WHERE id=?", admin);
        forbidden(() -> service.summary(admin));
        jdbc.update("UPDATE app.user_account SET status='ACTIVE', email_verification_required=TRUE WHERE id=?", admin);
        forbidden(() -> service.logins(admin, null, 0, 25));
    }

    @Test void searchIsLiteralCaseInsensitiveBoundedAndPaginationHasStableTies() {
        String prefix = "fixture-" + UUID.randomUUID();
        UUID first = account(prefix + "-A"), second = account(prefix + "-B"), literal = account(prefix + "-%_");
        jdbc.update("UPDATE app.user_account SET created_at='2026-09-01T00:00:00Z' WHERE id IN (?,?,?)", first, second, literal);
        var result = service.members(admin, prefix.toUpperCase(), "", 0, 2);
        assertThat(result.total()).isEqualTo(3);
        assertThat(result.items()).hasSize(2);
        assertThat(service.members(admin, prefix, "", 1, 2).items()).hasSize(1)
            .doesNotContainAnyElementsOf(result.items());
        assertThat(service.members(admin, "%_", "", 0, 25).items()).extracting(m -> m.id()).containsExactly(literal);
        jdbc.update("UPDATE app.user_account SET status='DISABLED' WHERE id=?", second);
        assertThat(service.members(admin, prefix, "DISABLED", 0, 25).items()).extracting(m -> m.id()).containsExactly(second);
        jdbc.update("UPDATE app.user_account SET email_verification_required=TRUE WHERE id=?", first);
        assertThat(service.members(admin, prefix, "PENDING_VERIFICATION", 0, 25).items()).extracting(m -> m.id()).containsExactly(first);
        for (int size : new int[]{0, 101}) assertThatThrownBy(() -> service.members(admin, "", "", 0, size)).isInstanceOf(ResponseStatusException.class);
        assertThatThrownBy(() -> service.members(admin, "x".repeat(101), "", 0, 25)).isInstanceOf(ResponseStatusException.class);
        assertThatThrownBy(() -> service.members(admin, "", "invalid", 0, 25)).isInstanceOf(ResponseStatusException.class);
        assertThatThrownBy(() -> service.logins(admin, null, -1, 25)).isInstanceOf(ResponseStatusException.class);
    }

    @Test void loginEventsAreTransactionalDoNotBackfillAndCountsDeduplicateUsers() {
        UUID user = account("login-" + UUID.randomUUID());
        assertThat(service.member(admin, user).lastLoginAt()).isNull();
        assertThat(service.logins(admin, user, 0, 25).items()).isEmpty();
        assertThat(service.logins(admin, user, 0, 25).recordingStartedAt()).isNotNull();
        long before = service.summary(admin).signedInLast7Days();
        Instant now = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS);
        var tx = new TransactionTemplate(transactions);
        tx.executeWithoutResult(s -> {
            activity.record(user, LoginActivityService.Method.REGISTRATION, now.minusSeconds(10));
            activity.record(user, LoginActivityService.Method.PASSWORD, now);
        });
        assertThat(service.logins(admin, user, 0, 25).total()).isEqualTo(2);
        assertThat(service.member(admin, user).lastLoginAt()).isEqualTo(now);
        assertThat(service.summary(admin).signedInLast7Days()).isEqualTo(before + 1);
        assertThatThrownBy(() -> tx.executeWithoutResult(s -> {
            activity.record(user, LoginActivityService.Method.PASSWORD, now.plusSeconds(1));
            throw new IllegalStateException("session issuance rolled back");
        })).isInstanceOf(IllegalStateException.class);
        assertThat(service.logins(admin, user, 0, 25).total()).isEqualTo(2);
    }

    @Test void dtoExcludesHashesTokensAndTenantContentAndMemberReaderCannotMutateLimits() throws Exception {
        UUID user = account("privacy-" + UUID.randomUUID());
        jdbc.update("UPDATE app.user_account SET password_hash='private-password-hash' WHERE id=?", user);
        String body = mvc.perform(get("/api/v2/admin/members/" + user).with(jwt().jwt(j -> j.subject(admin.toString()))))
            .andExpect(status().isOk()).andExpect(jsonPath("email").exists())
            .andExpect(jsonPath("passwordHash").doesNotExist()).andExpect(jsonPath("externalSubject").doesNotExist())
            .andReturn().getResponse().getContentAsString();
        assertThat(body).doesNotContain("private-password-hash", "refreshToken", "apiKey", "requirementText");
        mvc.perform(patch("/api/v2/admin/free-usage").with(jwt().jwt(j -> j.subject(admin.toString())))
            .contentType("application/json").content("{\"limit\":10,\"expectedEpoch\":0,\"expectedUpdatedAt\":\"2026-10-05T00:00:00Z\"}"))
            .andExpect(status().isForbidden());
        mvc.perform(delete("/api/v2/admin/members/" + user).with(jwt().jwt(j -> j.subject(admin.toString()))))
            .andExpect(status().isMethodNotAllowed());
    }

    @Test void auditReadsOriginalValuesWithoutCrossLedgerConversionOrDuplicateRows() {
        UUID id = UUID.randomUUID();
        jdbc.update("""
            INSERT INTO app.weekly_credit_admin_audit(id,actor_user_id,action,target,previous_value,new_value,previous_epoch,new_epoch)
            VALUES (?,?,'CHANGE_LIMIT','weekly_limit','100','125',0,0)
            """, id, admin);
        var entries = service.audits(admin, 0, 100).items().stream().filter(a -> a.id().equals(id)).toList();
        assertThat(entries).hasSize(1);
        assertThat(entries.getFirst().source()).isEqualTo("WEEKLY_CREDITS");
        assertThat(entries.getFirst().newValue()).isEqualTo("125");
        assertThatThrownBy(() -> jdbc.update("UPDATE app.weekly_credit_admin_audit SET new_value='0' WHERE id=?", id))
            .isInstanceOf(org.springframework.dao.DataAccessException.class);
    }

    private UUID account(String name) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO app.user_account(id,external_subject,email,display_name,status) VALUES (?,?,?,?, 'ACTIVE')",
            id, "synthetic:" + id, name + "@example.invalid", name);
        return id;
    }
    private void forbidden(org.assertj.core.api.ThrowableAssert.ThrowingCallable action) {
        assertThatThrownBy(action).isInstanceOfSatisfying(ResponseStatusException.class,
            error -> assertThat(error.getStatusCode().value()).isEqualTo(403));
    }
}
