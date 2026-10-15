package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.client.dto.request.InternalAgentRunRequest.ByokBudget;
import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest.ModelSelection;
import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest.RunBudget;
import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView;
import com.freelanceops.backend.domain.agentrun.entity.AgentRunEntity;
import com.freelanceops.backend.domain.agentrun.model.AgentRunStatus;
import com.freelanceops.backend.domain.agentrun.model.Provider;
import com.freelanceops.backend.domain.agentrun.model.ReasoningEffort;
import com.freelanceops.backend.domain.agentrun.repository.AgentRunRepository;
import com.freelanceops.backend.domain.project.repository.ProjectRepository;
import com.freelanceops.backend.domain.workspace.policy.AuthorizationDecision;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import com.freelanceops.backend.domain.workspace.service.WorkspaceAuthorizationService;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;

import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import tools.jackson.databind.ObjectMapper;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.Set;
import java.util.UUID;

/** 호출 전에 시도 횟수를 예약한다. 오류·취소·재시작·사용량 누락이 발생해도 예약을 복구하지 않는다. 제공사 통신과 플랫폼 금액 처리는 담당하지 않는다. */
@Service
public class ByokExecutionService {
    private static final Set<String> OPERATIONS =
            Set.of("department_work_product", "bounded_react_step");
    private static final Set<AgentRunStatus> TERMINAL =
            Set.of(
                    AgentRunStatus.COMPLETED,
                    AgentRunStatus.PARTIAL,
                    AgentRunStatus.FAILED,
                    AgentRunStatus.CANCELLED);
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    private final AIConnectionService connections;
    private final WorkspaceAuthorizationService authorization;
    private final AgentRunRepository runs;
    private final ProjectRepository projects;
    private final AgentBudgetPolicy budgetPolicy;

    public ByokExecutionService(
            JdbcTemplate jdbc,
            ObjectMapper mapper,
            AIConnectionService connections,
            WorkspaceAuthorizationService authorization,
            AgentRunRepository runs,
            ProjectRepository projects,
            AgentBudgetPolicy budgetPolicy) {
        this.jdbc = jdbc;
        this.mapper = mapper;
        this.connections = connections;
        this.authorization = authorization;
        this.runs = runs;
        this.projects = projects;
        this.budgetPolicy = budgetPolicy;
    }

    public record ExecutionPrincipal(
            UUID runId,
            UUID workspaceId,
            UUID projectId,
            UUID initiatedBy,
            Set<String> permissions) {}

    public record Attempt(
            @NotNull UUID callId,
            @NotNull UUID credentialId,
            @NotNull Provider provider,
            @NotNull String model,
            @NotNull ReasoningEffort reasoningEffort,
            @NotNull String fundingSource,
            @NotNull String serviceTier,
            @NotNull String operation,
            @Min(1) int inputTokens,
            @Min(1) int maxOutputTokens) {}

    public record Admission(
            UUID callId,
            boolean admitted,
            Instant validUntil,
            String fundingSource,
            String serviceTier) {}

    private record Scope(ByokBudget budget, boolean closed) {}

    @Transactional(propagation = Propagation.MANDATORY)
    public ByokBudget issue(
            UUID runId,
            UUID user,
            UUID workspace,
            UUID project,
            ModelSelection selection,
            RunBudget budget,
            String costNoticeVersion) {
        if (selection.credentialId() == null)
            throw rejected("BYOK_SCOPE_REQUIRED", "A personal credential is required");
        PlatformSpendTariff.validateSelection(selection);
        if (budget.maxDurationSeconds() < 1
                || budget.maxDurationSeconds() > 270
                || budget.maxModelCalls() < 1
                || budget.maxModelCalls() > 50
                || budget.maxInputTokens() < 1
                || budget.maxOutputTokens() < 1) {
            throw rejected("BYOK_SCOPE_INVALID", "Personal execution limits are invalid");
        }
        connections.validate(
                user, workspace, selection.credentialId(), selection.provider(), selection.model());
        // 키 식별자만으로 한도를 높이지 않도록 소유자·워크스페이스 멤버십·제공사·모델을 먼저 검증한다.
        budgetPolicy.enforcePersonal(budget);
        var existing = find(runId, false);
        if (existing != null) {
            requireBinding(existing.budget(), runId, user, workspace, project, selection, budget);
            if (!java.util.Objects.equals(existing.budget().costNoticeVersion(), costNoticeVersion))
                throw rejected(
                        "BYOK_SCOPE_INVALID", "Personal execution cost notice binding changed");
            requireOpen(existing);
            return existing.budget();
        }
        Instant until =
                ByokCostNoticePolicy.deadline(
                        costNoticeVersion, selection, now(), budget.maxDurationSeconds());
        ByokBudget scope =
                new ByokBudget(
                        UUID.randomUUID(),
                        runId,
                        workspace,
                        project,
                        user,
                        selection.credentialId(),
                        selection.provider(),
                        selection.model(),
                        selection.reasoningEffort(),
                        "BYOK",
                        "default",
                        until,
                        budget.maxModelCalls(),
                        budget.maxInputTokens(),
                        budget.maxOutputTokens(),
                        budget,
                        costNoticeVersion);
        jdbc.update(
                """
            INSERT INTO app.byok_execution_scope(scope_id,run_id,payload,valid_until,max_model_calls,max_input_tokens,max_output_tokens)
            VALUES (?,?,?::jsonb,?,?,?,?)
            """,
                scope.scopeId(),
                runId,
                mapper.writeValueAsString(scope),
                Timestamp.from(until),
                scope.maxModelCalls(),
                scope.maxInputTokens(),
                scope.maxOutputTokens());
        return scope;
    }

    /** 시작 요청 전달과 재개는 최초 발급한 실행 범위를 재사용한다. */
    @Transactional
    public ByokBudget validateRun(AgentRunEntity run) {
        AgentRunEntity locked =
                runs.findByIdAndWorkspaceIdForUpdate(run.id(), run.workspaceId())
                        .orElseThrow(
                                () ->
                                        rejected(
                                                "BYOK_SCOPE_INVALID",
                                                "Personal execution run is unavailable"));
        Scope scope = requireScope(locked.id(), false);
        requireBinding(
                scope.budget(),
                locked.id(),
                locked.initiatedBy(),
                locked.workspaceId(),
                locked.projectId(),
                selection(locked),
                locked.budget());
        if (TERMINAL.contains(locked.status())) throw closed();
        requireOpen(scope);
        requireCurrentAccess(locked);
        return scope.budget();
    }

    @Transactional
    public Admission admit(UUID scopeId, Attempt attempt, ExecutionPrincipal principal) {
        requirePrincipal(principal);
        AgentRunEntity run =
                runs.findByIdAndWorkspaceIdForUpdate(principal.runId(), principal.workspaceId())
                        .orElseThrow(
                                () ->
                                        rejected(
                                                "BYOK_SCOPE_INVALID",
                                                "Personal execution run is unavailable"));
        requirePrincipalBinding(run, principal);
        Scope state = requireScope(run.id(), true); // 교착 상태를 피하도록 실행 행을 먼저 잠그고 실행 범위 행을 잠근다.
        ByokBudget scope = state.budget();
        requireBinding(
                scope,
                run.id(),
                run.initiatedBy(),
                run.workspaceId(),
                run.projectId(),
                selection(run),
                run.budget());
        if (!scope.scopeId().equals(scopeId)
                || attempt == null
                || attempt.callId() == null
                || !scope.credentialId().equals(attempt.credentialId())
                || scope.provider() != attempt.provider()
                || !scope.model().equals(attempt.model())
                || scope.reasoningEffort() != attempt.reasoningEffort()
                || !scope.fundingSource().equals(attempt.fundingSource())
                || !scope.serviceTier().equals(attempt.serviceTier())
                || !OPERATIONS.contains(attempt.operation() == null ? "" : attempt.operation())
                || attempt.inputTokens() <= 0
                || attempt.maxOutputTokens() <= 0) {
            throw rejected(
                    "BYOK_SCOPE_INVALID",
                    "Provider attempt does not match the personal execution scope");
        }
        if (run.status() != AgentRunStatus.QUEUED && run.status() != AgentRunStatus.RUNNING)
            throw closed();
        requireOpen(state);
        requireCurrentAccess(run); // 유료 호출을 시도할 때마다 권한 철회와 프로젝트 삭제 여부를 확인한다.
        int inserted =
                jdbc.update(
                        """
            INSERT INTO app.byok_provider_attempt(call_id,scope_id,operation,input_tokens,output_tokens)
            VALUES (?,?,?,?,?) ON CONFLICT (call_id) DO NOTHING
            """,
                        attempt.callId(),
                        scopeId,
                        attempt.operation(),
                        attempt.inputTokens(),
                        attempt.maxOutputTokens());
        if (inserted != 1)
            throw rejected(
                    "BYOK_ATTEMPT_REPLAY",
                    "Provider attempt was already admitted; it must not be executed again");
        int changed =
                jdbc.update(
                        """
            UPDATE app.byok_execution_scope SET model_calls=model_calls+1,input_tokens=input_tokens+?,output_tokens=output_tokens+?
            WHERE scope_id=? AND NOT closed AND valid_until > clock_timestamp()
              AND model_calls < max_model_calls AND input_tokens + ? <= max_input_tokens
              AND output_tokens + ? <= max_output_tokens
            """,
                        attempt.inputTokens(),
                        attempt.maxOutputTokens(),
                        scopeId,
                        attempt.inputTokens(),
                        attempt.maxOutputTokens());
        if (changed != 1)
            throw new ByokExecutionException(
                    HttpStatus.TOO_MANY_REQUESTS,
                    "BYOK_LIMIT_EXHAUSTED",
                    "Personal execution call or token limits are exhausted; reservations are not reset by retry or resume");
        return new Admission(
                attempt.callId(),
                true,
                scope.validUntil(),
                scope.fundingSource(),
                scope.serviceTier());
    }

    @Transactional
    public void validateCredential(AgentRunEntity run, ExecutionPrincipal principal) {
        requirePrincipal(principal);
        requirePrincipalBinding(run, principal);
        validateRun(run);
    }

    /** 실행 범위를 닫으면 다시 열 수 없으며 예약한 시도 횟수도 복구하지 않는다. */
    @Transactional
    public void close(UUID runId) {
        jdbc.update(
                "UPDATE app.byok_execution_scope SET closed=TRUE WHERE run_id=? AND NOT closed",
                runId);
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void closeIfTerminal(UUID runId, AgentRunStatus status) {
        if (TERMINAL.contains(status)) close(runId);
    }

    /** 사용량은 표시와 감사에만 사용한다. 실행 한도를 반환하거나 늘리는 근거로 사용하지 않는다. */
    public void validateUsage(AgentRunEntity run, AgentRunView.AgentRunUsage usage) {
        Scope state = find(run.id(), false);
        if (state == null) {
            if (usage.byokScopeId() != null)
                throw rejected("BYOK_SCOPE_INVALID", "Usage has no personal execution scope");
            return; // 플랫폼에서 비용을 부담하던 기존 개인 키 실행은 종전 정산 방식을 유지한다.
        }
        ByokBudget scope = state.budget();
        if (!scope.scopeId().equals(usage.byokScopeId())
                || usage.platformReservationId() != null
                || usage.tariffVersion() != null
                || usage.platformCostUsd() == null
                || usage.platformCostUsd().signum() != 0
                || usage.unpricedExposure()
                || usage.modelCalls() != usage.providerCalls().size()
                || usage.modelCalls() > scope.maxModelCalls()
                || usage.inputTokens() > scope.maxInputTokens()
                || usage.outputTokens() > scope.maxOutputTokens())
            throw rejected("BYOK_SCOPE_INVALID", "Personal usage must not claim platform funding");
        for (var call : usage.providerCalls()) {
            if (!"BYOK".equals(call.fundingSource())
                    || call.provider() != scope.provider()
                    || !call.model().equals(scope.model())
                    || !OPERATIONS.contains(call.operation())
                    || call.costUsd().signum() != 0
                    || call.reservedCostUsd().signum() != 0) {
                throw rejected("BYOK_SCOPE_INVALID", "Personal usage provider binding is invalid");
            }
            Integer count =
                    jdbc.queryForObject(
                            """
                SELECT count(*) FROM app.byok_provider_attempt WHERE call_id=? AND scope_id=? AND operation=?
                AND input_tokens >= ? AND output_tokens >= ?
                """,
                            Integer.class,
                            call.callId(),
                            scope.scopeId(),
                            call.operation(),
                            call.inputTokens(),
                            call.outputTokens());
            if (count == null || count != 1)
                throw rejected(
                        "BYOK_SCOPE_INVALID", "Usage refers to an unadmitted personal attempt");
        }
    }

    private Scope requireScope(UUID run, boolean lock) {
        Scope scope = find(run, lock);
        if (scope == null)
            throw rejected(
                    "BYOK_SCOPE_REQUIRED",
                    "This personal run has no bounded scope; start a new run");
        return scope;
    }

    private Scope find(UUID run, boolean lock) {
        var rows =
                jdbc.query(
                        "SELECT payload::text,closed FROM app.byok_execution_scope WHERE run_id=?"
                                + (lock ? " FOR UPDATE" : ""),
                        (row, n) ->
                                new Scope(
                                        mapper.readValue(row.getString(1), ByokBudget.class),
                                        row.getBoolean(2)),
                        run);
        return rows.isEmpty() ? null : rows.getFirst();
    }

    private void requireOpen(Scope scope) {
        if (scope.closed()) throw closed();
        if (!now().isBefore(scope.budget().validUntil()))
            throw new ByokExecutionException(
                    HttpStatus.GONE,
                    "BYOK_SCOPE_EXPIRED",
                    "Personal execution time expired; pause or retry does not extend it. Start a new run");
    }

    private void requireCurrentAccess(AgentRunEntity run) {
        if (authorization.authorize(
                        run.initiatedBy(), run.workspaceId(), PermissionCode.PROJECT_READ)
                != AuthorizationDecision.ALLOWED)
            throw rejected("BYOK_SCOPE_INVALID", "Project access was revoked");
        projects.findByIdAndWorkspaceId(run.projectId(), run.workspaceId())
                .orElseThrow(() -> rejected("BYOK_SCOPE_INVALID", "Project is unavailable"))
                .requireNotDeleting();
        connections.validate(
                run.initiatedBy(),
                run.workspaceId(),
                run.credentialId(),
                run.provider(),
                run.model());
    }

    private static void requirePrincipal(ExecutionPrincipal principal) {
        if (principal == null
                || !principal.permissions().contains("agent.run")
                || !principal.permissions().contains("project.read"))
            throw rejected("BYOK_SCOPE_INVALID", "Personal execution delegation is invalid");
    }

    private static void requirePrincipalBinding(AgentRunEntity run, ExecutionPrincipal principal) {
        if (!run.id().equals(principal.runId())
                || !run.workspaceId().equals(principal.workspaceId())
                || !run.projectId().equals(principal.projectId())
                || !run.initiatedBy().equals(principal.initiatedBy()))
            throw rejected(
                    "BYOK_SCOPE_INVALID", "Personal execution principal does not match the run");
    }

    private static void requireBinding(
            ByokBudget scope,
            UUID run,
            UUID user,
            UUID workspace,
            UUID project,
            ModelSelection selection,
            RunBudget budget) {
        if (!scope.runId().equals(run)
                || !scope.initiatedBy().equals(user)
                || !scope.workspaceId().equals(workspace)
                || !scope.projectId().equals(project)
                || !scope.credentialId().equals(selection.credentialId())
                || scope.provider() != selection.provider()
                || !scope.model().equals(selection.model())
                || scope.reasoningEffort() != selection.reasoningEffort()
                || !scope.budget().equals(budget))
            throw rejected("BYOK_SCOPE_INVALID", "Personal execution binding or limits changed");
    }

    private static ModelSelection selection(AgentRunEntity run) {
        return new ModelSelection(
                run.provider(), run.model(), run.reasoningEffort(), run.credentialId());
    }

    private Instant now() {
        Timestamp now = jdbc.queryForObject("SELECT clock_timestamp()", Timestamp.class);
        if (now == null) throw new IllegalStateException("Database clock unavailable");
        return now.toInstant();
    }

    private static ByokExecutionException closed() {
        return rejected("BYOK_SCOPE_CLOSED", "Personal execution is closed or paused");
    }

    private static ByokExecutionException rejected(String code, String message) {
        return new ByokExecutionException(HttpStatus.CONFLICT, code, message);
    }
}
