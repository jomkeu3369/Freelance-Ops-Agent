package com.freelanceops.backend.integration;

import com.freelanceops.backend.domain.agentrun.client.dto.request.InternalAgentRunRequest.ByokBudget;
import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest.ModelSelection;
import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest.RunBudget;
import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView;
import com.freelanceops.backend.domain.agentrun.entity.AgentRunEntity;
import com.freelanceops.backend.domain.agentrun.model.*;
import com.freelanceops.backend.domain.agentrun.repository.AgentRunRepository;
import com.freelanceops.backend.domain.agentrun.service.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import static org.assertj.core.api.Assertions.*;

/** Real PostgreSQL, real authorization and credential validation. All rows and keys are synthetic.
 * No credential verification API, agent HTTP, or provider SDK is invoked. */
@Testcontainers(disabledWithoutDocker = true)
@SpringBootTest(properties={"app.environment=test","platform.ai.spend.enabled=false",
    "APP_BYOK_ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    "agent.command-dispatch-enabled=false","agent.reconciliation-enabled=false"})
@DirtiesContext(classMode=DirtiesContext.ClassMode.AFTER_CLASS)
@Timeout(60)
class ByokExecutionPostgresTest {
    @Container static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer(
        DockerImageName.parse("pgvector/pgvector:pg17").asCompatibleSubstituteFor("postgres"));
    @DynamicPropertySource static void datasource(DynamicPropertyRegistry registry) {
        registry.add("spring.flyway.create-schemas", () -> true);
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }
    @Autowired JdbcTemplate jdbc;
    @Autowired ByokExecutionService byok;
    @Autowired AgentRunGatewayService gateway;
    @Autowired PlatformSpendService platform;
    @Autowired PlatformUsageService platformUsage;
    @Autowired AIConnectionService connections;
    @Autowired AgentRunRepository runs;
    @Autowired AgentCostService costs;
    @Autowired PlatformTransactionManager manager;
    TransactionTemplate tx;
    UUID user, workspace, project, credential, member;
    static final String MODEL = "gpt-6-luna";
    static final RunBudget BUDGET = new RunBudget(180, 2, 12, 20000, 1000, 4, 2, 0, 1, 3);
    record Fixture(AgentRunEntity run, ByokBudget scope) { }
    @BeforeEach void setup() {
        tx = new TransactionTemplate(manager);
        user=UUID.randomUUID(); workspace=UUID.randomUUID(); project=UUID.randomUUID(); credential=UUID.randomUUID();
        member=UUID.randomUUID(); UUID role=UUID.randomUUID();
        jdbc.update("INSERT INTO app.user_account(id,external_subject,email,status) VALUES (?,?,?,'ACTIVE')",user,"byok-test:"+user,user+"@example.invalid");
        jdbc.update("INSERT INTO app.workspace(id,name,slug,status,created_by) VALUES (?,'Synthetic',?,'ACTIVE',?)",workspace,"byok-test-"+workspace,user);
        jdbc.update("INSERT INTO app.project(id,workspace_id,title,requirement_text,currency,created_by) VALUES (?,?,'Synthetic','Synthetic','USD',?)",project,workspace,user);
        jdbc.update("INSERT INTO app.workspace_member(id,workspace_id,user_id,status) VALUES (?,?,?,'ACTIVE')",member,workspace,user);
        jdbc.update("INSERT INTO app.workspace_role(id,workspace_id,code,display_name) VALUES (?,?,'TEST','Test')",role,workspace);
        for (String permission : List.of("agent.run","project.read","agent.respond","audit.read"))
            jdbc.update("INSERT INTO app.role_permission(workspace_id,role_id,permission_code) VALUES (?,?,?)",workspace,role,permission);
        jdbc.update("INSERT INTO app.member_role(workspace_id,membership_id,role_id,assigned_by) VALUES (?,?,?,?)",workspace,member,role,user);
        jdbc.update("INSERT INTO app.ai_connection(id,workspace_id,user_id,provider,model,ciphertext,masked_key) VALUES (?,?,?,'OPENAI',?,'synthetic-never-decrypted','test')",credential,workspace,user,MODEL);
    }
    ModelSelection selection(UUID id) { return new ModelSelection(Provider.OPENAI, MODEL, ReasoningEffort.LOW, id); }
    Fixture create(RunBudget budget) {
        var run = new AgentRunEntity(UUID.randomUUID(),workspace,project,UUID.randomUUID(),user,Provider.OPENAI,
            MODEL,ReasoningEffort.LOW,budget,AgentRunStatus.RUNNING,Instant.now());
        run.useCredential(credential);
        return tx.execute(s -> {
            var scope=byok.issue(run.id(),user,workspace,project,selection(credential),budget);
            runs.saveAndFlush(run);
            return new Fixture(run,scope);
        });
    }
    ByokExecutionService.ExecutionPrincipal principal(Fixture f) {
        return new ByokExecutionService.ExecutionPrincipal(f.run().id(),workspace,project,user,Set.of("agent.run","project.read"));
    }
    ByokExecutionService.Attempt attempt(UUID id) {
        return new ByokExecutionService.Attempt(id,credential,Provider.OPENAI,MODEL,ReasoningEffort.LOW,
            "BYOK","default","department_work_product",10000,500);
    }
    void admit(Fixture f, UUID call) { byok.admit(f.scope().scopeId(), attempt(call), principal(f)); }
    int consumed(Fixture f) { return jdbc.queryForObject("SELECT model_calls FROM app.byok_execution_scope WHERE scope_id=?",Integer.class,f.scope().scopeId()); }

    static RunBudget fullBudget(int input) { return new RunBudget(180,50,12,input,48000,4,2,2,2,3); }

    @Test void authenticatedPersonalStartGets150kWhilePlatformAndHigherPersonalRequestsRemainDenied() {
        var safety = new com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest.SafetyContext(false,false,false,false,false,false,false);
        var personal = new com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest("Synthetic analysis","en",null,selection(credential),fullBudget(150000),safety);
        var accepted = gateway.start(user,workspace,project,personal,null,"personal-150k");
        var persisted = runs.findById(accepted.runId()).orElseThrow();
        var scope = byok.validateRun(persisted);
        assertThat(scope.maxInputTokens()).isEqualTo(150000);
        assertThat(scope.budget()).isEqualTo(fullBudget(150000));
        assertThat(jdbc.queryForObject("SELECT max_input_tokens FROM app.byok_execution_scope WHERE run_id=?",Integer.class,accepted.runId())).isEqualTo(150000);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM app.platform_spend_reservation WHERE run_id=?",Integer.class,accepted.runId())).isZero();
        var tooLarge = new com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest("Synthetic analysis","en",null,selection(credential),fullBudget(150001),safety);
        assertThatThrownBy(() -> gateway.start(user,workspace,project,tooLarge,null))
            .isInstanceOf(org.springframework.web.server.ResponseStatusException.class).hasMessageContaining("422");
        var platformRequest = new com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest("Synthetic analysis","en",null,selection(null),fullBudget(50001),safety);
        assertThatThrownBy(() -> gateway.start(user,workspace,project,platformRequest,null))
            .isInstanceOf(org.springframework.web.server.ResponseStatusException.class).hasMessageContaining("422");
        for (var unauthorized : List.of(selection(UUID.randomUUID()),
            new ModelSelection(Provider.OPENAI,"gpt-6-sol",ReasoningEffort.LOW,credential))) {
            var invalid = new com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest("Synthetic analysis","en",null,unauthorized,fullBudget(150000),safety);
            assertThatThrownBy(() -> gateway.start(user,workspace,project,invalid,null))
                .isInstanceOf(org.springframework.web.server.ResponseStatusException.class).hasMessageContaining("404");
        }
        jdbc.update("DELETE FROM app.ai_connection WHERE id=?",credential);
        assertThatThrownBy(() -> byok.validateRun(persisted)).isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
        assertThatThrownBy(() -> gateway.start(user,workspace,project,personal,null,"revoked-150k"))
            .isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM app.agent_run WHERE workspace_id=?",Integer.class,workspace)).isOne();
    }

    @Test void changingPolicyNeverUpgradesExisting50kScopeOrRenewItsDeadline() {
        var f=create(fullBudget(50000));
        var original=byok.validateRun(f.run());
        assertThat(original.maxInputTokens()).isEqualTo(50000);
        assertThatThrownBy(() -> tx.execute(st -> byok.issue(f.run().id(),user,workspace,project,selection(credential),fullBudget(150000))))
            .isInstanceOf(ByokExecutionException.class).extracting(e -> ((ByokExecutionException)e).code()).isEqualTo("BYOK_SCOPE_INVALID");
        assertThat(byok.validateRun(f.run())).isEqualTo(original);
        assertThat(tx.execute(st -> byok.issue(f.run().id(),user,workspace,project,selection(credential),fullBudget(50000))))
            .isEqualTo(original);
        assertThat(jdbc.queryForObject("SELECT max_input_tokens FROM app.byok_execution_scope WHERE scope_id=?",Integer.class,original.scopeId())).isEqualTo(50000);
    }

    @Test void concurrent150kAdmissionsRemainBoundedAcrossRetryLikeAttempts() throws Exception {
        var f=create(fullBudget(150000)); var ready=new CountDownLatch(12); var start=new CountDownLatch(1);
        try (var pool=Executors.newVirtualThreadPerTaskExecutor()) {
            List<Future<Boolean>> results=new ArrayList<>();
            for (int i=0;i<12;i++) results.add(pool.submit(() -> {
                ready.countDown(); if (!start.await(10,TimeUnit.SECONDS)) throw new IllegalStateException("Barrier timeout");
                var claim=new ByokExecutionService.Attempt(UUID.randomUUID(),credential,Provider.OPENAI,MODEL,ReasoningEffort.LOW,
                    "BYOK","default","department_work_product",30000,1000);
                try { byok.admit(f.scope().scopeId(),claim,principal(f)); return true; } catch (ByokExecutionException expected) { return false; }
            }));
            assertThat(ready.await(10,TimeUnit.SECONDS)).isTrue(); start.countDown();
            int accepted=0; for (var result:results) if (result.get(20,TimeUnit.SECONDS)) accepted++;
            assertThat(accepted).isEqualTo(5);
        }
        assertThat(consumed(f)).isEqualTo(5);
        assertThat(jdbc.queryForObject("SELECT input_tokens FROM app.byok_execution_scope WHERE scope_id=?",Long.class,f.scope().scopeId())).isEqualTo(150000L);
        assertThat(jdbc.queryForObject("SELECT output_tokens FROM app.byok_execution_scope WHERE scope_id=?",Long.class,f.scope().scopeId())).isEqualTo(5000L);
        assertThatThrownBy(() -> admit(f,UUID.randomUUID())).isInstanceOf(ByokExecutionException.class);
        assertThatThrownBy(() -> byok.admit(UUID.randomUUID(),attempt(UUID.randomUUID()),principal(f))).isInstanceOf(ByokExecutionException.class);
    }

    @Test void publicGatewayIssuesExactlyOneScopeOnIdempotentStartWithoutPlatformSpend() {
        var safety = new com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest.SafetyContext(false,false,false,false,false,false,false);
        var request = new com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest("Synthetic analysis","en",null,selection(credential),BUDGET,safety);
        var accepted = gateway.start(user,workspace,project,request,null,"byok-test-start");
        var replay = gateway.start(user,workspace,project,request,null,"byok-test-start");
        assertThat(replay.runId()).isEqualTo(accepted.runId());
        assertThat(jdbc.queryForObject("SELECT count(*) FROM app.byok_execution_scope WHERE run_id=?",Integer.class,accepted.runId())).isOne();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM app.agent_run_command WHERE run_id=?",Integer.class,accepted.runId())).isOne();
        assertThat(jdbc.queryForObject("SELECT payload FROM app.agent_run_command WHERE run_id=?",String.class,accepted.runId()))
            .contains("byokBudget").contains("scopeId").contains("\"platformBudget\":null");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM app.platform_spend_reservation WHERE run_id=?",Integer.class,accepted.runId())).isZero();
        var platformRequest = new com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest("Synthetic analysis","en",null,selection(null),BUDGET,safety);
        assertThatThrownBy(() -> gateway.start(user,workspace,project,platformRequest,null)).isInstanceOf(PlatformSpendUnavailableException.class);
    }
    @Test void eachTokenLimitIsCheckedBeforeAdmissionAndRollbackDoesNotLeaveAttempt() {
        var f=create(BUDGET);
        for (var invalid : List.of(
            new ByokExecutionService.Attempt(UUID.randomUUID(),credential,Provider.OPENAI,MODEL,ReasoningEffort.LOW,"BYOK","default","department_work_product",20001,1),
            new ByokExecutionService.Attempt(UUID.randomUUID(),credential,Provider.OPENAI,MODEL,ReasoningEffort.LOW,"BYOK","default","department_work_product",1,1001)))
            assertThatThrownBy(() -> byok.admit(f.scope().scopeId(),invalid,principal(f))).isInstanceOf(ByokExecutionException.class);
        assertThat(consumed(f)).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM app.byok_provider_attempt WHERE scope_id=?",Integer.class,f.scope().scopeId())).isZero();
    }
    @Test void validPersonalRunWorksWithPlatformSpendOffAndNeverWritesMonetaryRows() {
        var f=create(BUDGET);
        admit(f,UUID.randomUUID());
        assertThat(consumed(f)).isOne();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM app.platform_spend_reservation WHERE run_id=?",Integer.class,f.run().id())).isZero();
        assertThatThrownBy(() -> tx.execute(s -> platform.reserve(user,UUID.randomUUID(),selection(null))))
            .isInstanceOf(PlatformSpendUnavailableException.class);
    }
    @Test void historyIncludesUserFundedAdmissionsWithUnknownProviderBillAndIsolation() {
        var f=create(BUDGET); admit(f,UUID.randomUUID());
        var item=platformUsage.history(user,null,20).items().getFirst();
        assertThat(item.runId()).isEqualTo(f.run().id());
        assertThat(item.platformCostUsd()).isZero();
        assertThat(item.platformReservedUsd()).isZero();
        assertThat(item.usageKnown()).isFalse();
        assertThat(item.byokInputTokens()).isEqualTo(10000);
        assertThat(item.byokOutputTokens()).isEqualTo(500);
        assertThat(item.providerCalls()).hasSize(1);
        assertThat(platformUsage.history(UUID.randomUUID(),null,20).items()).isEmpty();
        assertThat(platformUsage.snapshot(user).settledUsd()).isZero();
        assertThat(platformUsage.snapshot(user).reservedUsd()).isZero();
    }
    @Test void mixedHistoryPaginationIsStableAtEqualTimestampsAndDeletionCannotEraseAdmissions() {
        var f=create(BUDGET); admit(f,UUID.randomUUID());
        UUID platformRun=UUID.randomUUID();
        var at=jdbc.queryForObject("SELECT created_at FROM app.byok_execution_scope WHERE scope_id=?",java.sql.Timestamp.class,f.scope().scopeId());
        jdbc.update("""
            INSERT INTO app.platform_spend_reservation(run_id,user_id,provider,model,max_cost_usd,tariff_version,day_period,week_period,valid_until,created_at)
            VALUES (?,?,'OPENAI',?,.10,?,CURRENT_DATE,CURRENT_DATE,clock_timestamp()+INTERVAL '1 hour',?)
            """,platformRun,user,MODEL,PlatformSpendTariff.VERSION,at);
        jdbc.update("INSERT INTO app.platform_spend_settlement(run_id,reserved_usd) VALUES (?,.10)",platformRun);
        var first=platformUsage.history(user,null,1);
        assertThat(first.items()).hasSize(1); assertThat(first.nextCursor()).isNotNull();
        var second=platformUsage.history(user,first.nextCursor(),1);
        assertThat(second.items()).hasSize(1); assertThat(second.nextCursor()).isNull();
        assertThat(List.of(first.items().getFirst().runId(),second.items().getFirst().runId()))
            .containsExactlyInAnyOrder(f.run().id(),platformRun);
        assertThat(platformUsage.history(UUID.randomUUID(),first.nextCursor(),1).items()).isEmpty();
        jdbc.update("DELETE FROM app.workspace WHERE id=?",workspace);
        jdbc.update("DELETE FROM app.user_account WHERE id=?",user);
        assertThat(platformUsage.history(user,null,20).items()).hasSize(2).allMatch(item -> "DELETED".equals(item.status()));
        assertThat(consumed(f)).isOne();
        assertThatThrownBy(() -> admit(f,UUID.randomUUID())).isInstanceOf(ByokExecutionException.class);
    }
    @Test void scopeReplayAndRestartKeepOriginalDeadlineAndConsumedLimits() {
        var f=create(BUDGET); UUID first=UUID.randomUUID(); admit(f,first);
        var replay=tx.execute(s -> byok.issue(f.run().id(),user,workspace,project,selection(credential),BUDGET));
        assertThat(replay).isEqualTo(f.scope());
        assertThat(byok.validateRun(f.run())).isEqualTo(f.scope());
        assertThatThrownBy(() -> admit(f,first)).isInstanceOf(ByokExecutionException.class)
            .extracting(e -> ((ByokExecutionException)e).code()).isEqualTo("BYOK_ATTEMPT_REPLAY");
        admit(f,UUID.randomUUID());
        assertThatThrownBy(() -> admit(f,UUID.randomUUID())).isInstanceOf(ByokExecutionException.class);
        assertThat(consumed(f)).isEqualTo(2);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM app.byok_provider_attempt WHERE scope_id=?",Integer.class,f.scope().scopeId())).isEqualTo(2);
    }
    @Test void simultaneousInstancesCannotMultiplyCallOrTokenLimits() throws Exception {
        var f=create(BUDGET); var ready=new CountDownLatch(12); var start=new CountDownLatch(1);
        try (var pool=Executors.newVirtualThreadPerTaskExecutor()) {
            List<Future<Boolean>> results=new ArrayList<>();
            for (int i=0;i<12;i++) results.add(pool.submit(() -> {
                ready.countDown(); if (!start.await(10,TimeUnit.SECONDS)) throw new IllegalStateException("Barrier timeout");
                try { admit(f,UUID.randomUUID()); return true; } catch (ByokExecutionException expected) { return false; }
            }));
            assertThat(ready.await(10,TimeUnit.SECONDS)).isTrue(); start.countDown();
            int accepted=0; for (var result:results) if (result.get(20,TimeUnit.SECONDS)) accepted++;
            assertThat(accepted).isEqualTo(2);
        }
        assertThat(consumed(f)).isEqualTo(2);
        assertThat(jdbc.queryForObject("SELECT input_tokens FROM app.byok_execution_scope WHERE scope_id=?",Long.class,f.scope().scopeId())).isEqualTo(20000L);
    }
    @Test void changedPrincipalCredentialProviderModelAndOperationAreRejectedWithoutConsumption() {
        var f=create(BUDGET);
        var bad=new ByokExecutionService.ExecutionPrincipal(f.run().id(),workspace,project,UUID.randomUUID(),Set.of("agent.run","project.read"));
        assertThatThrownBy(() -> byok.admit(f.scope().scopeId(),attempt(UUID.randomUUID()),bad)).isInstanceOf(ByokExecutionException.class);
        assertThatThrownBy(() -> byok.admit(UUID.randomUUID(),attempt(UUID.randomUUID()),principal(f))).isInstanceOf(ByokExecutionException.class);
        for (var wrongScope : List.of(
            new ByokExecutionService.ExecutionPrincipal(f.run().id(),UUID.randomUUID(),project,user,Set.of("agent.run","project.read")),
            new ByokExecutionService.ExecutionPrincipal(f.run().id(),workspace,UUID.randomUUID(),user,Set.of("agent.run","project.read")),
            new ByokExecutionService.ExecutionPrincipal(UUID.randomUUID(),workspace,project,user,Set.of("agent.run","project.read"))))
            assertThatThrownBy(() -> byok.admit(f.scope().scopeId(),attempt(UUID.randomUUID()),wrongScope)).isInstanceOf(ByokExecutionException.class);
        for (var invalid: List.of(
            new ByokExecutionService.Attempt(UUID.randomUUID(),UUID.randomUUID(),Provider.OPENAI,MODEL,ReasoningEffort.LOW,"BYOK","default","department_work_product",10000,500),
            new ByokExecutionService.Attempt(UUID.randomUUID(),credential,Provider.GEMINI,MODEL,ReasoningEffort.LOW,"BYOK","default","department_work_product",10000,500),
            new ByokExecutionService.Attempt(UUID.randomUUID(),credential,Provider.OPENAI,"gpt-6-sol",ReasoningEffort.LOW,"BYOK","default","department_work_product",10000,500),
            new ByokExecutionService.Attempt(UUID.randomUUID(),credential,Provider.OPENAI,MODEL,ReasoningEffort.HIGH,"BYOK","default","department_work_product",10000,500),
            new ByokExecutionService.Attempt(UUID.randomUUID(),credential,Provider.OPENAI,MODEL,ReasoningEffort.LOW,"PLATFORM","default","department_work_product",10000,500),
            new ByokExecutionService.Attempt(UUID.randomUUID(),credential,Provider.OPENAI,MODEL,ReasoningEffort.LOW,"BYOK","flex","department_work_product",10000,500),
            new ByokExecutionService.Attempt(UUID.randomUUID(),credential,Provider.OPENAI,MODEL,ReasoningEffort.LOW,"BYOK","default","quotation_assumption",10000,500))) {
            assertThatThrownBy(() -> byok.admit(f.scope().scopeId(),invalid,principal(f))).isInstanceOf(ByokExecutionException.class);
        }
        assertThat(consumed(f)).isZero();
    }
    @Test void forgedUnownedRevokedAndMismatchedCredentialCannotAcquireScope() {
        for (var invalid: List.of(selection(UUID.randomUUID()),
            new ModelSelection(Provider.OPENAI,"gpt-6-sol",ReasoningEffort.LOW,credential),
            new ModelSelection(Provider.GEMINI,MODEL,ReasoningEffort.LOW,credential))) {
            assertThatThrownBy(() -> tx.execute(s -> byok.issue(UUID.randomUUID(),user,workspace,project,invalid,BUDGET)))
                .isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
        }
        assertThatThrownBy(() -> tx.execute(s -> byok.issue(UUID.randomUUID(),UUID.randomUUID(),workspace,project,selection(credential),BUDGET)))
            .isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
        jdbc.update("DELETE FROM app.ai_connection WHERE id=?",credential);
        assertThatThrownBy(() -> tx.execute(s -> byok.issue(UUID.randomUUID(),user,workspace,project,selection(credential),BUDGET)))
            .isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
    }
    @Test void deletingConnectionOrMembershipRevocationStopsEachNewAttemptAndResume() {
        var f=create(BUDGET); admit(f,UUID.randomUUID());
        jdbc.update("UPDATE app.workspace_member SET status='SUSPENDED' WHERE id=?",member);
        assertThatThrownBy(() -> admit(f,UUID.randomUUID())).isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
        assertThatThrownBy(() -> byok.validateRun(f.run())).isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
        jdbc.update("UPDATE app.workspace_member SET status='ACTIVE' WHERE id=?",member);
        jdbc.update("DELETE FROM app.ai_connection WHERE id=?",credential);
        assertThatThrownBy(() -> admit(f,UUID.randomUUID())).isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
        assertThat(consumed(f)).isOne();
    }
    @Test void cancellationAndDatabaseMutationsCannotReopenOrRefundScope() {
        var f=create(BUDGET); admit(f,UUID.randomUUID()); byok.close(f.run().id());
        assertThatThrownBy(() -> admit(f,UUID.randomUUID())).isInstanceOf(ByokExecutionException.class);
        assertThatThrownBy(() -> byok.validateRun(f.run())).isInstanceOf(ByokExecutionException.class);
        for (String sql:List.of("UPDATE app.byok_execution_scope SET closed=FALSE WHERE scope_id=?",
            "UPDATE app.byok_execution_scope SET model_calls=0 WHERE scope_id=?",
            "UPDATE app.byok_execution_scope SET valid_until=valid_until+INTERVAL '1 hour' WHERE scope_id=?",
            "DELETE FROM app.byok_execution_scope WHERE scope_id=?"))
            assertThatThrownBy(() -> jdbc.update(sql,f.scope().scopeId())).isInstanceOf(org.springframework.dao.DataAccessException.class);
        assertThatThrownBy(() -> jdbc.update("DELETE FROM app.byok_provider_attempt WHERE scope_id=?",f.scope().scopeId()))
            .isInstanceOf(org.springframework.dao.DataAccessException.class);
        assertThat(consumed(f)).isOne();
    }
    @Test void expirationIsFixedAndLegacyPersonalRunsCannotMintScopeOnResume() throws Exception {
        var f=create(new RunBudget(1,2,12,20000,1000,4,2,0,1,3));
        Thread.sleep(1100);
        assertThatThrownBy(() -> admit(f,UUID.randomUUID())).isInstanceOf(ByokExecutionException.class)
            .extracting(e -> ((ByokExecutionException)e).code()).isEqualTo("BYOK_SCOPE_EXPIRED");
        assertThatThrownBy(() -> byok.validateRun(f.run())).isInstanceOf(ByokExecutionException.class);
        var legacy=new AgentRunEntity(UUID.randomUUID(),workspace,project,UUID.randomUUID(),user,Provider.OPENAI,MODEL,
            ReasoningEffort.LOW,BUDGET,AgentRunStatus.WAITING_FOR_USER,Instant.now()); legacy.useCredential(credential);
        tx.executeWithoutResult(s -> runs.saveAndFlush(legacy));
        assertThatThrownBy(() -> byok.validateRun(legacy)).isInstanceOf(ByokExecutionException.class)
            .extracting(e -> ((ByokExecutionException)e).code()).isEqualTo("BYOK_SCOPE_REQUIRED");
    }
    @Test void personalUsageIsUnpricedAndCannotClaimPlatformMoneyOrUnadmittedAttempts() {
        var f=create(BUDGET); UUID call=UUID.randomUUID(); admit(f,call);
        var provider=new AgentRunView.ProviderCallUsage(call,Provider.OPENAI,MODEL,"department_work_product",10000,500,0,0,
            java.math.BigDecimal.ZERO,java.math.BigDecimal.ZERO,false,"BYOK");
        var usage=new AgentRunView.AgentRunUsage(RequestTier.SINGLE_AGENT,1,0,10000,500,0,0,0,0,10,List.of(provider),
            java.math.BigDecimal.ZERO,null,null,true,false,f.scope().scopeId());
        var view=new AgentRunView(f.run().id(),AgentRunStatus.COMPLETED,null,null,null,null,null,usage,Instant.now());
        tx.executeWithoutResult(s -> costs.synchronize(f.run(),view));
        assertThat(jdbc.queryForObject("SELECT cost_status FROM app.agent_run_usage WHERE agent_run_id=?",String.class,f.run().id())).isEqualTo("UNPRICED");
        assertThat(jdbc.queryForObject("SELECT actual_cost FROM app.agent_run_usage WHERE agent_run_id=?",java.math.BigDecimal.class,f.run().id())).isNull();
        assertThat(jdbc.queryForObject("SELECT platform_cost_usd FROM app.agent_run_usage WHERE agent_run_id=?",java.math.BigDecimal.class,f.run().id())).isZero();
        var unadmitted=new AgentRunView.ProviderCallUsage(UUID.randomUUID(),Provider.OPENAI,MODEL,"department_work_product",10000,500,0,0,
            java.math.BigDecimal.ZERO,java.math.BigDecimal.ZERO,false,"BYOK");
        var ambient=new AgentRunView.ProviderCallUsage(call,Provider.OPENAI,MODEL,"department_work_product",10000,500,0,0,
            java.math.BigDecimal.ZERO,java.math.BigDecimal.ZERO,false,"PLATFORM");
        var charged=new AgentRunView.ProviderCallUsage(call,Provider.OPENAI,MODEL,"department_work_product",10000,500,0,0,
            java.math.BigDecimal.ONE,java.math.BigDecimal.ZERO,false,"BYOK");
        for (var invalidCall:List.of(unadmitted,ambient,charged)) {
            var invalidUsage=new AgentRunView.AgentRunUsage(RequestTier.SINGLE_AGENT,1,0,10000,500,0,0,0,0,10,List.of(invalidCall),
                java.math.BigDecimal.ZERO,null,null,true,false,f.scope().scopeId());
            var invalidView=new AgentRunView(f.run().id(),AgentRunStatus.COMPLETED,null,null,null,null,null,invalidUsage,Instant.now());
            assertThatThrownBy(() -> tx.executeWithoutResult(st -> costs.synchronize(f.run(),invalidView))).isInstanceOf(ByokExecutionException.class);
        }
        var invalidScopeUsage=new AgentRunView.AgentRunUsage(RequestTier.SINGLE_AGENT,1,0,10000,500,0,0,0,0,10,List.of(provider),
            java.math.BigDecimal.ZERO,null,null,true,false,UUID.randomUUID());
        var invalidScopeView=new AgentRunView(f.run().id(),AgentRunStatus.COMPLETED,null,null,null,null,null,invalidScopeUsage,Instant.now());
        assertThatThrownBy(() -> tx.executeWithoutResult(st -> costs.synchronize(f.run(),invalidScopeView))).isInstanceOf(ByokExecutionException.class);
        assertThat(jdbc.queryForObject("SELECT provider_calls->0->>'callId' FROM app.agent_run_usage WHERE agent_run_id=?",String.class,f.run().id())).isEqualTo(call.toString());
        assertThat(jdbc.queryForObject("SELECT count(*) FROM app.platform_spend_reservation WHERE run_id=?",Integer.class,f.run().id())).isZero();
    }
}
