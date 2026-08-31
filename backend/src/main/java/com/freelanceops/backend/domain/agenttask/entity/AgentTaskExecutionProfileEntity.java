package com.freelanceops.backend.domain.agenttask.entity;

import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest;
import com.freelanceops.backend.domain.agentrun.model.Provider;
import com.freelanceops.backend.domain.agentrun.model.ReasoningEffort;
import com.freelanceops.backend.domain.agenttask.model.AgentTaskRiskLevel;
import com.freelanceops.backend.domain.agenttask.model.AgentTaskRoute;
import com.freelanceops.backend.domain.agenttask.model.AgentTaskToolProfile;
import jakarta.persistence.Column;
import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.List;
import java.util.HashSet;
import java.util.Objects;
import java.util.UUID;

@Entity
@Table(name = "agent_task_execution_profile", schema = "app")
public class AgentTaskExecutionProfileEntity {

    @EmbeddedId private AgentTaskExecutionProfileId id;
    @Column(name = "workspace_id", nullable = false) private UUID workspaceId;
    @Column(name = "run_id", nullable = false) private UUID runId;
    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 30) private AgentTaskRoute route;
    @Enumerated(EnumType.STRING) @Column(name = "risk_level", nullable = false, length = 20) private AgentTaskRiskLevel riskLevel;
    @Column(name = "model_profile", nullable = false, length = 100) private String modelProfile;
    @Enumerated(EnumType.STRING) @Column(name = "tool_profile", nullable = false, length = 30) private AgentTaskToolProfile toolProfile;
    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 20) private Provider provider;
    @Column(nullable = false, length = 100) private String model;
    @Enumerated(EnumType.STRING) @Column(name = "reasoning_effort", nullable = false, length = 20) private ReasoningEffort reasoningEffort;
    @JdbcTypeCode(SqlTypes.JSON) @Column(nullable = false, columnDefinition = "jsonb") private List<String> permissions;
    @Column(name = "max_duration_seconds", nullable = false) private int maxDurationSeconds;
    @Column(name = "max_model_calls", nullable = false) private int maxModelCalls;
    @Column(name = "max_tool_calls", nullable = false) private int maxToolCalls;
    @Column(name = "max_input_tokens", nullable = false) private int maxInputTokens;
    @Column(name = "max_output_tokens", nullable = false) private int maxOutputTokens;
    @Column(name = "max_departments", nullable = false) private int maxDepartments;
    @Column(name = "max_hierarchy_depth", nullable = false) private int maxHierarchyDepth;
    @Column(name = "max_search_credits", nullable = false) private int maxSearchCredits;
    @Column(name = "max_retries", nullable = false) private int maxRetries;
    @Column(name = "max_handoffs", nullable = false) private int maxHandoffs;
    @Column(name = "authorization_revision", nullable = false) private long authorizationRevision;
    @Column(name = "budget_revision", nullable = false) private long budgetRevision;
    @Column(name = "route_profile_version", nullable = false, length = 100) private String routeProfileVersion;
    @Column(name = "guard_policy_version", nullable = false, length = 100) private String guardPolicyVersion;
    @Column(name = "created_at", nullable = false) private Instant createdAt;

    protected AgentTaskExecutionProfileEntity() {
    }

    public AgentTaskExecutionProfileEntity(AgentTaskExecutionProfileId id, UUID workspaceId, UUID runId,
                                           AgentTaskRoute route, AgentTaskRiskLevel riskLevel, String modelProfile,
                                           AgentTaskToolProfile toolProfile, Provider provider, String model,
                                           ReasoningEffort reasoningEffort, List<String> permissions,
                                           StartAgentRunRequest.RunBudget budget, long authorizationRevision,
                                           long budgetRevision, String routeProfileVersion,
                                           String guardPolicyVersion, Instant createdAt) {
        this.id = Objects.requireNonNull(id);
        this.workspaceId = Objects.requireNonNull(workspaceId);
        this.runId = Objects.requireNonNull(runId);
        this.route = Objects.requireNonNull(route);
        this.riskLevel = Objects.requireNonNull(riskLevel);
        this.modelProfile = requireText(modelProfile, "modelProfile");
        this.toolProfile = Objects.requireNonNull(toolProfile);
        this.provider = Objects.requireNonNull(provider);
        this.model = requireText(model, "model");
        this.reasoningEffort = Objects.requireNonNull(reasoningEffort);
        this.permissions = List.copyOf(Objects.requireNonNull(permissions));
        if (new HashSet<>(this.permissions).size() != this.permissions.size()) {
            throw new IllegalArgumentException("permissions must be unique");
        }
        budget = Objects.requireNonNull(budget);
        this.maxDurationSeconds = budget.maxDurationSeconds();
        this.maxModelCalls = budget.maxModelCalls();
        this.maxToolCalls = budget.maxToolCalls();
        this.maxInputTokens = budget.maxInputTokens();
        this.maxOutputTokens = budget.maxOutputTokens();
        this.maxDepartments = budget.maxDepartments();
        this.maxHierarchyDepth = budget.maxHierarchyDepth();
        this.maxSearchCredits = budget.maxSearchCredits();
        this.maxRetries = budget.maxRetries();
        this.maxHandoffs = budget.maxHandoffs();
        if (authorizationRevision < 1 || budgetRevision < 1) {
            throw new IllegalArgumentException("policy revisions must be positive");
        }
        this.authorizationRevision = authorizationRevision;
        this.budgetRevision = budgetRevision;
        this.routeProfileVersion = requireText(routeProfileVersion, "routeProfileVersion");
        this.guardPolicyVersion = requireText(guardPolicyVersion, "guardPolicyVersion");
        this.createdAt = Objects.requireNonNull(createdAt);
    }

    public AgentTaskExecutionProfileId id() { return id; }
    public UUID workspaceId() { return workspaceId; }
    public UUID runId() { return runId; }
    public AgentTaskRoute route() { return route; }
    public AgentTaskRiskLevel riskLevel() { return riskLevel; }
    public AgentTaskToolProfile toolProfile() { return toolProfile; }
    public List<String> permissions() { return List.copyOf(permissions); }
    public long authorizationRevision() { return authorizationRevision; }
    public long budgetRevision() { return budgetRevision; }
    public String routeProfileVersion() { return routeProfileVersion; }
    public String guardPolicyVersion() { return guardPolicyVersion; }

    private static String requireText(String value, String name) {
        if (value == null || value.isBlank()) throw new IllegalArgumentException(name + " must not be blank");
        return value;
    }
}
