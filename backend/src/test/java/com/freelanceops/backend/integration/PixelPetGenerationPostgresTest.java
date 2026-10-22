package com.freelanceops.backend.integration;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.freelanceops.backend.domain.agentrun.client.PixelPetGenerationClient;
import com.freelanceops.backend.domain.agentrun.dto.PetProfile;
import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest.ModelSelection;
import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView.*;
import com.freelanceops.backend.domain.agentrun.model.*;
import com.freelanceops.backend.domain.agentrun.security.DelegationTokenIssuer;
import com.freelanceops.backend.domain.agentrun.service.*;
import com.freelanceops.backend.domain.workspace.policy.*;
import com.freelanceops.backend.domain.workspace.repository.WorkspacePermissionReader;

import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.server.ResponseStatusException;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

import tools.jackson.databind.ObjectMapper;

import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;

@Testcontainers
@SpringBootTest(
        properties = {
            "app.environment=test",
            "platform.ai.spend.enabled=true",
            "agent.command-dispatch-enabled=false",
            "agent.reconciliation-enabled=false"
        })
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class PixelPetGenerationPostgresTest {
    @Container
    static final PostgreSQLContainer POSTGRES =
            new PostgreSQLContainer(
                    DockerImageName.parse("pgvector/pgvector:pg17")
                            .asCompatibleSubstituteFor("postgres"));

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registry.add("spring.flyway.create-schemas", () -> true);
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper mapper;
    @Autowired PixelPetGenerationService generation;
    @Autowired CustomAgentPetService pets;
    @Autowired PlatformSpendService spending;
    @Autowired PlatformUsageService usage;
    @Autowired PlatformTransactionManager transactions;
    @MockitoBean PixelPetGenerationClient client;
    @MockitoBean AIConnectionService authorization;
    @MockitoBean WorkspacePermissionReader permissions;
    @MockitoBean DelegationTokenIssuer tokens;
    UUID user, workspace, project;
    PetProfile draft;

    @BeforeEach
    void setup() throws Exception {
        reset(client, authorization, permissions, tokens);
        when(tokens.issueForPersonalRun(any(), any(), any(), any(), anyList(), eq(60)))
                .thenReturn("synthetic-delegation");
        user = UUID.randomUUID();
        workspace = UUID.randomUUID();
        project = UUID.randomUUID();
        jdbc.execute(
                "TRUNCATE"
                    + " app.agent_run_usage,app.platform_external_tool_attempt,app.platform_provider_attempt,app.platform_spend_settlement,app.platform_spend_reservation,app.platform_spend_bucket,app.pet_generation");
        jdbc.update(
                "UPDATE app.platform_spend_settings SET"
                    + " account_week_usd=1.25,global_day_usd=25,global_week_usd=100 WHERE id=1");
        jdbc.update(
                "UPDATE app.platform_spend_model_cap SET enabled=true,max_run_usd=.10 WHERE"
                        + " model='gpt-6.1-sol'");
        jdbc.update(
                "INSERT INTO app.user_account(id,external_subject,email,status) VALUES"
                        + " (?,?,?,'ACTIVE')",
                user,
                "pixel:" + user,
                user + "@example.invalid");
        jdbc.update(
                "INSERT INTO app.workspace(id,name,slug,status,created_by) VALUES"
                        + " (?,'Synthetic',?,'ACTIVE',?)",
                workspace,
                "pixel-" + workspace,
                user);
        jdbc.update(
                "INSERT INTO"
                        + " app.project(id,workspace_id,title,requirement_text,currency,created_by)"
                        + " VALUES (?,?,'Synthetic','Synthetic','USD',?)",
                project,
                workspace,
                user);
        when(permissions.findActiveMembership(any(), any()))
                .thenReturn(
                        Optional.of(
                                new MembershipPermissions(
                                        UUID.randomUUID(),
                                        Set.of(
                                                PermissionCode.AGENT_RUN,
                                                PermissionCode.PROJECT_READ))));
        draft =
                mapper.readValue(
                        Files.readString(Path.of("../contracts/fixtures/pixel-pet-profile.json")),
                        PetProfile.class);
    }

    CustomAgentPetService.Compose input() {
        return new CustomAgentPetService.Compose(
                UUID.randomUUID(), UUID.randomUUID(), 0, "실현 가능성을 꼼꼼히 판단하는 펭귄", false);
    }

    PixelPetGenerationService.Generate request(CustomAgentPetService.Compose input) {
        return new PixelPetGenerationService.Generate(project, input);
    }

    PixelPetGenerationService.GenerationPrincipal principal(UUID id) {
        return new PixelPetGenerationService.GenerationPrincipal(
                id, workspace, project, user, Set.of("agent.run", "project.read"));
    }

    AgentRunUsage report(UUID id, UUID callId, boolean known, boolean closed) {
        var call =
                new ProviderCallUsage(
                        callId,
                        Provider.OPENAI,
                        "gpt-6.1-sol",
                        "pixel_pet_profile",
                        1000,
                        500,
                        0,
                        0,
                        new BigDecimal(".007"),
                        new BigDecimal(".05"),
                        known,
                        "PLATFORM");
        return new AgentRunUsage(
                RequestTier.SINGLE_AGENT,
                1,
                0,
                1000,
                500,
                0,
                0,
                0,
                0,
                1,
                List.of(call),
                new BigDecimal(".007"),
                id,
                PlatformSpendTariff.VERSION,
                closed);
    }

    void successfulModel(boolean loseResponse) {
        when(client.generate(any(), anyString()))
                .thenAnswer(
                        invocation -> {
                            var input = (PixelPetGenerationClient.Input) invocation.getArgument(0);
                            var output =
                                    new PixelPetGenerationClient.Output(
                                            draft,
                                            report(
                                                    input.context().runId(),
                                                    UUID.randomUUID(),
                                                    true,
                                                    true));
                            generation.complete(
                                    input.context().runId(),
                                    output,
                                    principal(input.context().runId()));
                            if (loseResponse)
                                throw new ResourceAccessException("Synthetic lost response");
                            return output;
                        });
    }

    @Test
    void generationAndSaveReplaysKeepOneModelCallOnePetAndActualCost() {
        successfulModel(false);
        var input = input();
        var result = generation.generate(user, workspace, request(input));
        assertThat(result.status()).isEqualTo("COMPLETED");
        assertThat(result.profile().animal()).isEqualTo("pixel");
        assertThat(result.profile().sprite().species()).isEqualTo("펭귄");
        assertThat(result.profile().preferences().requests()).containsExactly(input.description());
        assertThat(generation.generate(user, workspace, request(input))).isEqualTo(result);
        var save =
                new CustomAgentPetService.Compose(
                        input.id(), input.mutationId(), 0, input.description(), false, result.id());
        var saved = pets.save(user, workspace, save);
        assertThat(pets.save(user, workspace, save)).isEqualTo(saved);
        assertThat(pets.list(user, workspace).pets()).hasSize(1);
        assertThat(pets.runtimeProfiles(user, workspace).orElseThrow().getFirst().sprite())
                .isEqualTo(draft.sprite());
        verify(client, times(1)).generate(any(), anyString());
        var entry = usage.history(user, null, 20).items().getFirst();
        assertThat(entry.status()).isEqualTo("COMPLETED");
        assertThat(entry.platformCostUsd()).isEqualByComparingTo(".007");
        assertThat(entry.usageKnown()).isTrue();
        assertThat(
                        jdbc.queryForObject(
                                "SELECT settled_usd FROM app.platform_spend_settlement WHERE"
                                        + " run_id=?",
                                BigDecimal.class,
                                result.id()))
                .isEqualByComparingTo(".007");
        assertThat(
                        jdbc.queryForObject(
                                "SELECT reserved_usd FROM app.platform_spend_settlement WHERE"
                                        + " run_id=?",
                                BigDecimal.class,
                                result.id()))
                .isEqualByComparingTo("0");
    }

    @Test
    void completedCallbackSurvivesLostHttpResponseAndCanBeReadAgain() {
        successfulModel(true);
        var input = input();
        var result = generation.generate(user, workspace, request(input));
        assertThat(result.status()).isEqualTo("COMPLETED");
        assertThat(generation.get(user, workspace, result.id())).isEqualTo(result);
        assertThat(generation.generate(user, workspace, request(input))).isEqualTo(result);
        verify(client, times(1)).generate(any(), anyString());
    }

    @Test
    void anotherOperationReservationCannotBeReusedForPetGeneration() {
        var input = input();
        new TransactionTemplate(transactions)
                .execute(
                        status ->
                                spending.reserve(
                                        user,
                                        input.mutationId(),
                                        new ModelSelection(
                                                Provider.OPENAI,
                                                "gpt-6.1-sol",
                                                ReasoningEffort.LOW),
                                        new BigDecimal(".10")));
        assertThatThrownBy(() -> generation.generate(user, workspace, request(input)))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("PET_ID_UNAVAILABLE");
        verifyNoInteractions(client);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM app.pet_generation WHERE id=?",
                                Integer.class,
                                input.mutationId()))
                .isZero();
    }

    @Test
    void completedEditCanBeReplayedAfterSavingItsNewRevision() {
        successfulModel(false);
        var original = input();
        var first = generation.generate(user, workspace, request(original));
        pets.save(
                user,
                workspace,
                new CustomAgentPetService.Compose(
                        original.id(),
                        original.mutationId(),
                        0,
                        original.description(),
                        false,
                        first.id()));
        var edit =
                new CustomAgentPetService.Compose(
                        original.id(), UUID.randomUUID(), 1, "말투를 더 다정하게", false);
        var second = generation.generate(user, workspace, request(edit));
        pets.save(
                user,
                workspace,
                new CustomAgentPetService.Compose(
                        edit.id(), edit.mutationId(), 1, edit.description(), false, second.id()));
        assertThat(generation.generate(user, workspace, request(edit))).isEqualTo(second);
        assertThat(pets.list(user, workspace).pets().getFirst().revision()).isEqualTo(2);
        verify(client, times(2)).generate(any(), anyString());
    }

    @Test
    void unknownProviderOutcomeKeepsReservationAndNeverRetriesSameJob() {
        when(client.generate(any(), anyString()))
                .thenThrow(new ResourceAccessException("Synthetic timeout"));
        var input = input();
        var result = generation.generate(user, workspace, request(input));
        assertThat(result.status()).isEqualTo("UNKNOWN");
        assertThat(generation.generate(user, workspace, request(input)).status())
                .isEqualTo("UNKNOWN");
        verify(client, times(1)).generate(any(), anyString());
        assertThat(
                        jdbc.queryForObject(
                                "SELECT reserved_usd FROM app.platform_spend_settlement WHERE"
                                        + " run_id=?",
                                BigDecimal.class,
                                result.id()))
                .isEqualByComparingTo(".10");
    }

    @Test
    void generatedResultCannotBeReadOrSavedByAnotherOwnerOrWithChangedInput() {
        successfulModel(false);
        var input = input();
        var result = generation.generate(user, workspace, request(input));
        assertThatThrownBy(() -> generation.get(UUID.randomUUID(), workspace, result.id()))
                .hasMessageContaining("404");
        assertThatThrownBy(() -> generation.get(user, UUID.randomUUID(), result.id()))
                .hasMessageContaining("404");
        var changed =
                new CustomAgentPetService.Compose(
                        input.id(), input.mutationId(), 0, "다른 설명", false);
        assertThatThrownBy(() -> generation.generate(user, workspace, request(changed)))
                .hasMessageContaining("PET_REQUEST_REUSED");
        assertThatThrownBy(
                        () ->
                                pets.save(
                                        user,
                                        workspace,
                                        new CustomAgentPetService.Compose(
                                                input.id(),
                                                input.mutationId(),
                                                0,
                                                "다른 설명",
                                                false,
                                                result.id())))
                .hasMessageContaining("PET_GENERATION_NOT_READY");
        verify(client, times(1)).generate(any(), anyString());
    }

    @Test
    void dailyLimitBlocksBeforeModelAndMonetaryReservation() {
        for (int n = 0; n < 20; n++)
            jdbc.update(
                    "INSERT INTO app.pet_generation(id,workspace_id,user_id,provider,model,status)"
                            + " VALUES (?,?,?,'OPENAI','gpt-6.1-sol','FAILED')",
                    UUID.randomUUID(),
                    workspace,
                    user);
        assertThatThrownBy(() -> generation.generate(user, workspace, request(input())))
                .hasMessageContaining("PET_DAILY_LIMIT");
        verifyNoInteractions(client);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM app.platform_spend_reservation", Long.class))
                .isZero();
    }

    @Test
    void revocationBlocksBeforeAnyModelOrReservation() {
        doThrow(new ResponseStatusException(HttpStatus.FORBIDDEN))
                .when(authorization)
                .authorize(user, workspace);
        assertThatThrownBy(() -> generation.generate(user, workspace, request(input())))
                .hasMessageContaining("403");
        verifyNoInteractions(client);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM app.platform_spend_reservation", Long.class))
                .isZero();
    }

    @Test
    void secondAttemptIdCannotConsumeAnotherModelCallInSameGeneration() {
        UUID callId = UUID.randomUUID();
        when(client.generate(any(), anyString()))
                .thenAnswer(
                        invocation -> {
                            var input = (PixelPetGenerationClient.Input) invocation.getArgument(0);
                            generation.recordUsage(
                                    input.context().runId(),
                                    report(input.context().runId(), callId, false, false),
                                    principal(input.context().runId()));
                            throw new ResourceAccessException("Synthetic timeout");
                        });
        var result = generation.generate(user, workspace, request(input()));
        assertThatThrownBy(
                        () ->
                                generation.recordUsage(
                                        result.id(),
                                        report(result.id(), UUID.randomUUID(), false, false),
                                        principal(result.id())))
                .hasMessageContaining("PET_CALL_LIMIT");
        generation.recordUsage(
                result.id(), report(result.id(), callId, true, true), principal(result.id()));
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM app.platform_provider_attempt WHERE run_id=?",
                                Long.class,
                                result.id()))
                .isEqualTo(1);
    }
}
