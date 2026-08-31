package com.freelanceops.backend.domain.agenttask.service;

import com.freelanceops.backend.domain.agentrun.entity.AgentRunEntity;
import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest.RunBudget;
import com.freelanceops.backend.domain.agentrun.repository.AgentRunRepository;
import com.freelanceops.backend.domain.agentrun.service.AgentBudgetPolicy;
import com.freelanceops.backend.domain.agenttask.dto.request.AgentTaskExecutionProfileRequest;
import com.freelanceops.backend.domain.agenttask.entity.AgentTaskEntity;
import com.freelanceops.backend.domain.agenttask.entity.AgentTaskExecutionProfileEntity;
import com.freelanceops.backend.domain.agenttask.entity.AgentTaskExecutionProfileId;
import com.freelanceops.backend.domain.agenttask.model.AgentTaskRiskLevel;
import com.freelanceops.backend.domain.agenttask.model.AgentTaskRoute;
import com.freelanceops.backend.domain.agenttask.model.AgentTaskToolProfile;
import com.freelanceops.backend.domain.internaltool.security.DelegationPrincipal;
import com.freelanceops.backend.domain.workspace.policy.MembershipPermissions;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import com.freelanceops.backend.domain.workspace.repository.WorkspacePermissionReader;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

@Component
public class AgentTaskGuard {

    private final WorkspacePermissionReader permissionReader;
    private final AgentRunRepository runRepository;
    private final AgentBudgetPolicy budgetPolicy;
    private final String routeProfileVersion;
    private final String guardPolicyVersion;

    public AgentTaskGuard(WorkspacePermissionReader permissionReader, AgentRunRepository runRepository,
                          AgentBudgetPolicy budgetPolicy,
                          @Value("${agent.routing.profile-version:route-profile-v1}") String routeProfileVersion,
                          @Value("${agent.task-guard.policy-version:task-guard-v1}") String guardPolicyVersion) {
        this.permissionReader = permissionReader;
        this.runRepository = runRepository;
        this.budgetPolicy = budgetPolicy;
        this.routeProfileVersion = routeProfileVersion;
        this.guardPolicyVersion = guardPolicyVersion;
    }

    public AgentTaskExecutionProfileEntity validate(AgentTaskEntity task, AgentTaskExecutionProfileRequest profile,
                                                      DelegationPrincipal principal, Instant now) {
        AgentRunEntity run = runRepository.findByIdAndWorkspaceId(task.runId(), task.workspaceId())
            .orElseThrow(() -> reject(HttpStatus.NOT_FOUND, "TASK_RUN_NOT_FOUND"));
        if (!run.initiatedBy().equals(principal.initiatedBy()) || !run.id().equals(principal.runId())) {
            throw reject(HttpStatus.FORBIDDEN, "TASK_WORKLOAD_IDENTITY_MISMATCH");
        }
        MembershipPermissions membership = permissionReader
            .findActiveMembership(run.initiatedBy(), task.workspaceId())
            .orElseThrow(() -> reject(HttpStatus.FORBIDDEN, "TASK_MEMBERSHIP_REVOKED"));
        Set<String> currentPermissions = membership.permissions().stream().map(PermissionCode::code)
            .collect(java.util.stream.Collectors.toUnmodifiableSet());
        requirePermissions(profile.permissions(), currentPermissions, principal.permissions());
        requireProfile(profile, run);
        budgetPolicy.enforce(profile.budget());
        requireWithinRunBudget(profile.budget(), run.budget());
        return new AgentTaskExecutionProfileEntity(new AgentTaskExecutionProfileId(task.id(), task.revision()),
            task.workspaceId(), task.runId(), profile.route(), profile.riskLevel(), profile.modelProfile(),
            profile.toolProfile(), profile.provider(), profile.model(), profile.reasoningEffort(),
            profile.permissions(), profile.budget(), authorizationRevision(currentPermissions), 1,
            profile.routeProfileVersion(),
            profile.guardPolicyVersion(), now);
    }

    private void requireProfile(AgentTaskExecutionProfileRequest profile, AgentRunEntity run) {
        if (!routeProfileVersion.equals(profile.routeProfileVersion())
            || !guardPolicyVersion.equals(profile.guardPolicyVersion())) {
            throw reject(HttpStatus.CONFLICT, "TASK_POLICY_VERSION_STALE");
        }
        if (profile.route() == AgentTaskRoute.HUMAN_REQUIRED || profile.riskLevel() == AgentTaskRiskLevel.RESTRICTED) {
            throw reject(HttpStatus.CONFLICT, "TASK_HUMAN_APPROVAL_REQUIRED");
        }
        if (profile.toolProfile() == AgentTaskToolProfile.BOUNDED_WRITE) {
            throw reject(HttpStatus.CONFLICT, "TASK_WRITE_PROFILE_NOT_ENABLED");
        }
        boolean toolRoute = profile.route() == AgentTaskRoute.DIRECT_TOOL
            || profile.route() == AgentTaskRoute.REACT_AGENT || profile.route() == AgentTaskRoute.SUPERVISOR;
        if (toolRoute != (profile.toolProfile() == AgentTaskToolProfile.READ_ONLY)) {
            throw reject(HttpStatus.UNPROCESSABLE_CONTENT, "TASK_TOOL_PROFILE_INVALID");
        }
        if (profile.provider() != run.provider() || !profile.model().equals(run.model())
            || profile.reasoningEffort() != run.reasoningEffort()) {
            throw reject(HttpStatus.CONFLICT, "TASK_MODEL_PROFILE_MISMATCH");
        }
        String expectedModelProfile = switch (profile.route()) {
            case DIRECT_TOOL -> "direct-tool-v1";
            case SIMPLE_LLM -> "simple-llm-v1";
            case REACT_AGENT -> "react-read-v1";
            case SUPERVISOR -> "supervisor-v1";
            case HUMAN_REQUIRED -> "human-required";
        };
        if (!expectedModelProfile.equals(profile.modelProfile())) {
            throw reject(HttpStatus.CONFLICT, "TASK_MODEL_PROFILE_UNAPPROVED");
        }
    }

    private static void requirePermissions(List<String> requested, Set<String> current, Set<String> delegated) {
        Set<String> distinct = new HashSet<>(requested);
        if (distinct.size() != requested.size()) {
            throw reject(HttpStatus.UNPROCESSABLE_CONTENT, "TASK_PERMISSION_DUPLICATED");
        }
        if (!distinct.contains("agent.run") || !distinct.contains("project.read")
            || !current.contains("agent.run") || !current.contains("project.read")
            || !current.containsAll(distinct) || !delegated.containsAll(distinct)) {
            throw reject(HttpStatus.FORBIDDEN, "TASK_PERMISSION_DENIED");
        }
        if (requested.stream().anyMatch(permission -> !permission.equals("agent.run") && !permission.endsWith(".read"))) {
            throw reject(HttpStatus.FORBIDDEN, "TASK_PERMISSION_PROFILE_NOT_LEAST_PRIVILEGE");
        }
    }

    private static void requireWithinRunBudget(RunBudget requested, RunBudget maximum) {
        if (requested.maxDurationSeconds() > maximum.maxDurationSeconds()
            || requested.maxModelCalls() > maximum.maxModelCalls()
            || requested.maxToolCalls() > maximum.maxToolCalls()
            || requested.maxInputTokens() > maximum.maxInputTokens()
            || requested.maxOutputTokens() > maximum.maxOutputTokens()
            || requested.maxDepartments() > maximum.maxDepartments()
            || requested.maxHierarchyDepth() > maximum.maxHierarchyDepth()
            || requested.maxSearchCredits() > maximum.maxSearchCredits()
            || requested.maxRetries() > maximum.maxRetries()
            || requested.maxHandoffs() > maximum.maxHandoffs()) {
            throw reject(HttpStatus.UNPROCESSABLE_CONTENT, "TASK_BUDGET_EXCEEDED");
        }
    }

    private static long authorizationRevision(Set<String> permissions) {
        String canonical = permissions.stream().sorted().collect(java.util.stream.Collectors.joining("\n"));
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                .digest(canonical.getBytes(StandardCharsets.UTF_8));
            long revision = ByteBuffer.wrap(digest).getLong() & Long.MAX_VALUE;
            return revision == 0 ? 1 : revision;
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("SHA-256 is unavailable", impossible);
        }
    }

    private static ResponseStatusException reject(HttpStatus status, String reason) {
        return new ResponseStatusException(status, reason);
    }
}
