package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.client.PixelPetGenerationClient;
import com.freelanceops.backend.domain.agentrun.client.dto.request.InternalAgentRunRequest.PlatformBudget;
import com.freelanceops.backend.domain.agentrun.client.dto.request.InternalAgentRunRequest.TrustedRunContext;
import com.freelanceops.backend.domain.agentrun.dto.PetPreferences;
import com.freelanceops.backend.domain.agentrun.dto.PetProfile;
import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest.ModelSelection;
import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest.RunBudget;
import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView.AgentRunUsage;
import com.freelanceops.backend.domain.agentrun.model.Provider;
import com.freelanceops.backend.domain.agentrun.model.ReasoningEffort;
import com.freelanceops.backend.domain.agentrun.security.DelegationTokenIssuer;
import com.freelanceops.backend.domain.project.repository.ProjectRepository;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import com.freelanceops.backend.domain.workspace.repository.WorkspacePermissionReader;

import jakarta.validation.Valid;
import jakarta.validation.Validator;
import jakarta.validation.constraints.NotNull;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.server.ResponseStatusException;

import tools.jackson.databind.ObjectMapper;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Set;
import java.util.UUID;

/** 생성 요청의 중복 방지, 모델 호출과 저장 전 결과 보관을 담당한다. */
@Service
public class PixelPetGenerationService {
    public record Generate(
            @NotNull UUID projectId, @NotNull @Valid CustomAgentPetService.Compose input) {}

    public record GenerationPrincipal(
            UUID runId,
            UUID workspaceId,
            UUID projectId,
            UUID initiatedBy,
            Set<String> permissions) {}

    public record Generation(UUID id, String status, PetProfile profile, String errorCode) {}

    private record Prepared(PlatformBudget budget, PetProfile previous) {}

    private record Stored(
            Generation value,
            UUID project,
            String fingerprint,
            Instant updatedAt,
            String model,
            CustomAgentPetService.Compose input,
            PetProfile previous) {}

    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    private final Validator validator;
    private final CustomAgentPetService pets;
    private final AIConnectionService authorization;
    private final WorkspacePermissionReader permissions;
    private final ProjectRepository projects;
    private final PlatformSpendService spending;
    private final PlatformUsageService usage;
    private final PixelPetGenerationClient client;
    private final DelegationTokenIssuer tokens;
    private final TransactionTemplate transaction;
    private final ModelSelection model;

    public PixelPetGenerationService(
            JdbcTemplate jdbc,
            ObjectMapper mapper,
            Validator validator,
            CustomAgentPetService pets,
            AIConnectionService authorization,
            WorkspacePermissionReader permissions,
            ProjectRepository projects,
            PlatformSpendService spending,
            PlatformUsageService usage,
            PixelPetGenerationClient client,
            DelegationTokenIssuer tokens,
            PlatformTransactionManager transactions,
            @Value("${app.pets.generation-model:gpt-6.1-sol}") String model) {
        this.jdbc = jdbc;
        this.mapper = mapper;
        this.validator = validator;
        this.pets = pets;
        this.authorization = authorization;
        this.permissions = permissions;
        this.projects = projects;
        this.spending = spending;
        this.usage = usage;
        this.client = client;
        this.tokens = tokens;
        this.transaction = new TransactionTemplate(transactions);
        this.model = new ModelSelection(Provider.OPENAI, model, ReasoningEffort.LOW);
        PlatformSpendTariff.validateSelection(this.model);
    }

    public Generation generate(UUID user, UUID workspace, Generate request) {
        authorization.authorize(user, workspace);
        var input = request.input();
        if (input.generationId() != null)
            throw failure(HttpStatus.BAD_REQUEST, "PET_INVALID_GENERATION");
        var membership =
                permissions
                        .findActiveMembership(user, workspace)
                        .orElseThrow(
                                () -> failure(HttpStatus.NOT_FOUND, "PET_PROJECT_UNAVAILABLE"));
        if (!membership.permissions().contains(PermissionCode.PROJECT_READ))
            throw failure(HttpStatus.FORBIDDEN, "PET_PROJECT_UNAVAILABLE");
        projects.findByIdAndWorkspaceId(request.projectId(), workspace)
                .orElseThrow(() -> failure(HttpStatus.NOT_FOUND, "PET_PROJECT_UNAVAILABLE"))
                .requireNotDeleting();
        UUID id = input.mutationId();
        String fingerprint = pets.fingerprint(input);
        var prepared =
                transaction.execute(
                        status -> {
                            jdbc.query(
                                    "SELECT pg_advisory_xact_lock(hashtextextended(?, 0))",
                                    (row, n) -> 0,
                                    workspace + ":pixel-pet:" + user);
                            var existing = find(user, workspace, id);
                            if (existing != null) {
                                if (!existing.fingerprint().equals(fingerprint)
                                        || !existing.project().equals(request.projectId()))
                                    throw failure(HttpStatus.CONFLICT, "PET_REQUEST_REUSED");
                                return null;
                            }
                            if (Boolean.TRUE.equals(
                                    jdbc.queryForObject(
                                            "SELECT EXISTS (SELECT 1 FROM"
                                                + " app.platform_spend_reservation WHERE run_id=?)",
                                            Boolean.class,
                                            id)))
                                throw failure(HttpStatus.CONFLICT, "PET_ID_UNAVAILABLE");
                            pets.checkGenerationCapacity(user, workspace, input);
                            PetProfile previous = pets.generationBase(user, workspace, input);
                            Long count =
                                    jdbc.queryForObject(
                                            "SELECT count(*) FROM app.pet_generation WHERE"
                                                + " workspace_id=? AND user_id=? AND created_at >="
                                                + " (date_trunc('day', CURRENT_TIMESTAMP AT TIME"
                                                + " ZONE 'UTC') AT TIME ZONE 'UTC')",
                                            Long.class,
                                            workspace,
                                            user);
                            if (count != null && count >= 20)
                                throw failure(HttpStatus.TOO_MANY_REQUESTS, "PET_DAILY_LIMIT");
                            Long pending =
                                    jdbc.queryForObject(
                                            "SELECT count(*) FROM app.pet_generation WHERE"
                                                + " workspace_id=? AND user_id=? AND request_hash"
                                                + " IS NOT NULL AND status='REQUESTED' AND"
                                                + " updated_at > clock_timestamp() - interval '90"
                                                + " seconds'",
                                            Long.class,
                                            workspace,
                                            user);
                            if (pending != null && pending > 0)
                                throw failure(HttpStatus.CONFLICT, "PET_GENERATION_IN_PROGRESS");
                            if (previous != null && previous.preferences().requests().size() >= 6)
                                throw failure(
                                        HttpStatus.UNPROCESSABLE_CONTENT,
                                        "PET_PREFERENCE_HISTORY_FULL");
                            int inserted =
                                    jdbc.update(
                                            """
                                            INSERT INTO app.pet_generation(id,workspace_id,user_id,provider,model,project_id,pet_id,expected_revision,request_hash,request_json,previous_json)
                                            VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING
                                            """,
                                            id,
                                            workspace,
                                            user,
                                            model.provider().name(),
                                            model.model(),
                                            request.projectId(),
                                            input.id(),
                                            input.expectedRevision(),
                                            fingerprint,
                                            mapper.writeValueAsString(input),
                                            previous == null
                                                    ? null
                                                    : mapper.writeValueAsString(previous));
                            if (inserted != 1)
                                throw failure(HttpStatus.CONFLICT, "PET_ID_UNAVAILABLE");
                            return new Prepared(
                                    spending.reserve(user, id, model, new BigDecimal("0.10")),
                                    previous);
                        });
        if (prepared == null) return get(user, workspace, id);
        var codes = membership.permissions().stream().map(PermissionCode::code).sorted().toList();
        var context =
                new TrustedRunContext(
                        id,
                        UUID.randomUUID(),
                        id.toString(),
                        workspace,
                        request.projectId(),
                        user,
                        codes);
        var limits = new RunBudget(60, 1, 0, 32000, 4096, 1, 1, 0, 0, 0);
        try {
            var output =
                    client.generate(
                            new PixelPetGenerationClient.Input(
                                    context,
                                    model,
                                    input.description(),
                                    prepared.previous(),
                                    prepared.budget(),
                                    limits),
                            tokens.issueForPersonalRun(
                                    id, workspace, request.projectId(), user, codes, 60));
            transaction.executeWithoutResult(status -> persistResult(user, workspace, id, output));
        } catch (RuntimeException error) {
            // 같은 식별자는 실패 후에도 재호출하지 않는다. 모델 응답이 불명확하면 금액 예약도 유지한다.
            String state = error instanceof ResourceAccessException ? "UNKNOWN" : "FAILED";
            jdbc.update(
                    "UPDATE app.pet_generation SET"
                        + " status=?,error_code='PET_GENERATION_FAILED',updated_at=clock_timestamp()"
                        + " WHERE id=? AND workspace_id=? AND user_id=? AND status='REQUESTED'",
                    state,
                    id,
                    workspace,
                    user);
        }
        return get(user, workspace, id);
    }

    public Generation get(UUID user, UUID workspace, UUID id) {
        authorization.authorize(user, workspace);
        var stored = find(user, workspace, id);
        if (stored == null) throw failure(HttpStatus.NOT_FOUND, "PET_GENERATION_NOT_FOUND");
        if ("REQUESTED".equals(stored.value().status())
                && stored.updatedAt().isBefore(Instant.now().minusSeconds(90)))
            return new Generation(id, "UNKNOWN", null, "PET_GENERATION_UNKNOWN");
        return stored.value();
    }

    @Transactional
    public void recordUsage(UUID id, AgentRunUsage report, GenerationPrincipal principal) {
        var stored = find(principal.initiatedBy(), principal.workspaceId(), id, true);
        if (stored == null
                || !id.equals(principal.runId())
                || !stored.project().equals(principal.projectId())
                || !principal.permissions().contains("agent.run")
                || !principal.permissions().contains("project.read")
                || report == null
                || !id.equals(report.platformReservationId())
                || report.modelCalls() > 1
                || report.modelCalls() < 0
                || report.inputTokens() < 0
                || report.inputTokens() > 32000
                || report.outputTokens() < 0
                || report.outputTokens() > 4096
                || report.byokScopeId() != null
                || report.providerCalls() == null
                || report.providerCalls().size() != report.modelCalls())
            throw failure(HttpStatus.FORBIDDEN, "PET_USAGE_BINDING_MISMATCH");
        var attempts =
                jdbc.query(
                        "SELECT call_id FROM app.platform_provider_attempt WHERE run_id=?",
                        (row, n) -> row.getObject(1, UUID.class),
                        id);
        for (var call : report.providerCalls()) {
            if (call.provider() != Provider.OPENAI
                    || !stored.model().equals(call.model())
                    || !"pixel_pet_profile".equals(call.operation())
                    || !"PLATFORM".equals(call.fundingSource())
                    || call.callId() == null
                    || call.inputTokens() < 0
                    || call.inputTokens() > 32000
                    || call.outputTokens() < 0
                    || call.outputTokens() > 4096
                    || call.cachedReadTokens() < 0
                    || call.cacheWriteTokens() < 0
                    || call.cachedReadTokens() + call.cacheWriteTokens() > call.inputTokens()
                    || call.reservedCostUsd() == null
                    || call.reservedCostUsd().signum() < 0
                    || call.reservedCostUsd().compareTo(new BigDecimal("0.10")) > 0)
                throw failure(HttpStatus.FORBIDDEN, "PET_USAGE_BINDING_MISMATCH");
            if (!attempts.isEmpty() && !attempts.contains(call.callId()))
                throw failure(HttpStatus.CONFLICT, "PET_CALL_LIMIT");
        }
        if (report.inputTokens()
                        != report.providerCalls().stream()
                                .mapToLong(call -> call.inputTokens())
                                .sum()
                || report.outputTokens()
                        != report.providerCalls().stream()
                                .mapToLong(call -> call.outputTokens())
                                .sum())
            throw failure(HttpStatus.FORBIDDEN, "PET_USAGE_BINDING_MISMATCH");
        if (attempts.isEmpty() && !report.providerCalls().isEmpty()) {
            authorization.authorize(principal.initiatedBy(), principal.workspaceId());
            if (!permissions
                    .findActiveMembership(principal.initiatedBy(), principal.workspaceId())
                    .map(member -> member.permissions().contains(PermissionCode.PROJECT_READ))
                    .orElse(false)) throw failure(HttpStatus.FORBIDDEN, "PET_PROJECT_UNAVAILABLE");
            projects.findByIdAndWorkspaceId(principal.projectId(), principal.workspaceId())
                    .orElseThrow(() -> failure(HttpStatus.NOT_FOUND, "PET_PROJECT_UNAVAILABLE"))
                    .requireNotDeleting();
        }
        // 정산은 권한 회수 뒤에도 보존한다. 저장·선택 권한은 공개 API에서 다시 확인한다.
        usage.synchronizeOperation(
                id,
                principal.initiatedBy(),
                Provider.OPENAI,
                stored.model(),
                null,
                report,
                Instant.now(),
                Boolean.TRUE.equals(report.executionClosed()));
    }

    @Transactional
    public void complete(
            UUID id, PixelPetGenerationClient.Output output, GenerationPrincipal principal) {
        if (output == null) throw failure(HttpStatus.BAD_REQUEST, "PET_INVALID_GENERATION");
        recordUsage(id, output.usage(), principal);
        persistResult(principal.initiatedBy(), principal.workspaceId(), id, output);
    }

    private void persistResult(
            UUID user, UUID workspace, UUID id, PixelPetGenerationClient.Output output) {
        var stored = find(user, workspace, id, true);
        if (stored == null
                || output == null
                || output.profile() == null
                || !"pixel".equals(output.profile().animal())
                || !validator.validate(output.profile()).isEmpty()
                || output.usage() == null
                || output.usage().modelCalls() != 1
                || !id.equals(output.usage().platformReservationId()))
            throw failure(HttpStatus.BAD_REQUEST, "PET_INVALID_GENERATION");
        var generated = output.profile();
        var requests = new ArrayList<String>();
        if (stored.previous() != null) requests.addAll(stored.previous().preferences().requests());
        requests.add(stored.input().description());
        var preferences = generated.preferences();
        var profile =
                new PetProfile(
                        "RECOMMENDED",
                        generated.name(),
                        "pixel",
                        generated.color(),
                        generated.accessory(),
                        generated.tone(),
                        generated.valuePriority(),
                        generated.deliveryPriority(),
                        generated.scopePriority(),
                        stored.input().id(),
                        generated.duty(),
                        "AUTO",
                        new PetPreferences(
                                preferences.personality(),
                                preferences.communication(),
                                preferences.focus(),
                                preferences.responsibility(),
                                requests),
                        generated.sprite());
        String serialized = mapper.writeValueAsString(profile);
        if (serialized.length() > 12000 || !validator.validate(profile).isEmpty())
            throw failure(HttpStatus.BAD_REQUEST, "PET_INVALID_GENERATION");
        if (stored.value().profile() != null) {
            if (!stored.value().profile().equals(profile))
                throw failure(HttpStatus.CONFLICT, "PET_REQUEST_REUSED");
            return;
        }
        jdbc.update(
                "UPDATE app.pet_generation SET"
                    + " status='COMPLETED',profile_json=?,input_tokens=?,output_tokens=?,error_code=NULL,updated_at=clock_timestamp()"
                    + " WHERE id=? AND workspace_id=? AND user_id=?",
                serialized,
                output.usage().inputTokens(),
                output.usage().outputTokens(),
                id,
                workspace,
                user);
    }

    private Stored find(UUID user, UUID workspace, UUID id) {
        return find(user, workspace, id, false);
    }

    private Stored find(UUID user, UUID workspace, UUID id, boolean lock) {
        return jdbc
                .query(
                        "SELECT"
                            + " project_id,request_hash,status,profile_json,error_code,updated_at,model,request_json,previous_json"
                            + " FROM app.pet_generation WHERE id=? AND workspace_id=? AND user_id=?"
                            + " AND request_hash IS NOT NULL"
                                + (lock ? " FOR UPDATE" : ""),
                        (row, n) ->
                                new Stored(
                                        new Generation(
                                                id,
                                                row.getString(3),
                                                row.getString(4) == null
                                                        ? null
                                                        : mapper.readValue(
                                                                row.getString(4), PetProfile.class),
                                                row.getString(5)),
                                        row.getObject(1, UUID.class),
                                        row.getString(2),
                                        row.getTimestamp(6).toInstant(),
                                        row.getString(7),
                                        mapper.readValue(
                                                row.getString(8),
                                                CustomAgentPetService.Compose.class),
                                        row.getString(9) == null
                                                ? null
                                                : mapper.readValue(
                                                        row.getString(9), PetProfile.class)),
                        id,
                        workspace,
                        user)
                .stream()
                .findFirst()
                .orElse(null);
    }

    private static ResponseStatusException failure(HttpStatus status, String code) {
        return new ResponseStatusException(status, code);
    }
}
