package com.freelanceops.backend.domain.agentrun.entity;

import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest.RunBudget;
import com.freelanceops.backend.domain.agentrun.model.AgentRunStatus;
import com.freelanceops.backend.domain.agentrun.model.Provider;
import com.freelanceops.backend.domain.agentrun.model.ReasoningEffort;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "agent_run", schema = "app")
public class AgentRunEntity {

    @Id
    private UUID id;

    @Column(name = "workspace_id", nullable = false)
    private UUID workspaceId;

    @Column(name = "project_id", nullable = false)
    private UUID projectId;

    @Column(name = "thread_id", nullable = false)
    private UUID threadId;

    @Column(name = "initiated_by", nullable = false)
    private UUID initiatedBy;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private Provider provider;

    @Column(nullable = false, length = 100)
    private String model;

    @Enumerated(EnumType.STRING)
    @Column(name = "reasoning_effort", nullable = false, length = 20)
    private ReasoningEffort reasoningEffort;

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

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 30)
    private AgentRunStatus status;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Column(name = "next_reconciliation_at", nullable = false)
    private Instant nextReconciliationAt;

    @Version
    private long version;

    protected AgentRunEntity() {
    }

    public AgentRunEntity(UUID id, UUID workspaceId, UUID projectId, UUID threadId, UUID initiatedBy, Provider provider, String model, AgentRunStatus status, Instant now) {
        this(id, workspaceId, projectId, threadId, initiatedBy, provider, model, ReasoningEffort.LOW,
            defaultBudget(), status, now);
    }

    public AgentRunEntity(UUID id, UUID workspaceId, UUID projectId, UUID threadId, UUID initiatedBy,
                          Provider provider, String model, ReasoningEffort reasoningEffort,
                          AgentRunStatus status, Instant now) {
        this(id, workspaceId, projectId, threadId, initiatedBy, provider, model, reasoningEffort,
            defaultBudget(), status, now);
    }

    public AgentRunEntity(UUID id, UUID workspaceId, UUID projectId, UUID threadId, UUID initiatedBy,
                          Provider provider, String model, ReasoningEffort reasoningEffort, RunBudget budget,
                          AgentRunStatus status, Instant now) {
        this.id = id;
        this.workspaceId = workspaceId;
        this.projectId = projectId;
        this.threadId = threadId;
        this.initiatedBy = initiatedBy;
        this.provider = provider;
        this.model = model;
        this.reasoningEffort = reasoningEffort;
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
        this.status = status;
        this.createdAt = now;
        this.updatedAt = now;
        this.nextReconciliationAt = now;
    }

    public void updateStatus(AgentRunStatus status, Instant now) {
        this.status = status;
        this.updatedAt = now;
        this.nextReconciliationAt = now;
    }

    public void synchronizeStatus(AgentRunStatus status, Instant now) {
        if (isTerminal(this.status) || this.status == status) {
            return;
        }
        // 늦게 도착한 START 응답(QUEUED)이 이미 RUNNING인 public projection을 되돌리지 못하게 한다.
        if (this.status == AgentRunStatus.RUNNING && status == AgentRunStatus.QUEUED) {
            return;
        }
        updateStatus(status, now);
    }

    private static boolean isTerminal(AgentRunStatus status) {
        return status == AgentRunStatus.COMPLETED
            || status == AgentRunStatus.PARTIAL
            || status == AgentRunStatus.FAILED
            || status == AgentRunStatus.CANCELLED;
    }

    public void scheduleReconciliation(Instant when) {
        this.nextReconciliationAt = when;
    }

    public UUID id() {
        return id;
    }

    public UUID workspaceId() {
        return workspaceId;
    }

    public UUID projectId() {
        return projectId;
    }

    public UUID threadId() {
        return threadId;
    }

    public UUID initiatedBy() {
        return initiatedBy;
    }

    public Provider provider() {
        return provider;
    }

    public String model() {
        return model;
    }

    public ReasoningEffort reasoningEffort() {
        return reasoningEffort;
    }

    public RunBudget budget() {
        return new RunBudget(maxDurationSeconds, maxModelCalls, maxToolCalls, maxInputTokens, maxOutputTokens,
            maxDepartments, maxHierarchyDepth, maxSearchCredits, maxRetries, maxHandoffs);
    }

    public AgentRunStatus status() {
        return status;
    }

    private static RunBudget defaultBudget() {
        return new RunBudget(180, 50, 12, 50000, 48000, 4, 2, 2, 2, 3);
    }
}


