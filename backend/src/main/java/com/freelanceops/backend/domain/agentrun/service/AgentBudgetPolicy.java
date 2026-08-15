package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest.RunBudget;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

@Component
public class AgentBudgetPolicy {

    private final RunBudget maximum;

    public AgentBudgetPolicy(
        @Value("${agent.quota.max-duration-seconds:180}") int maxDurationSeconds,
        @Value("${agent.quota.max-model-calls:12}") int maxModelCalls,
        @Value("${agent.quota.max-tool-calls:12}") int maxToolCalls,
        @Value("${agent.quota.max-input-tokens:50000}") int maxInputTokens,
        @Value("${agent.quota.max-output-tokens:12000}") int maxOutputTokens,
        @Value("${agent.quota.max-departments:4}") int maxDepartments,
        @Value("${agent.quota.max-hierarchy-depth:2}") int maxHierarchyDepth,
        @Value("${agent.quota.max-search-credits:2}") int maxSearchCredits,
        @Value("${agent.quota.max-retries:2}") int maxRetries,
        @Value("${agent.quota.max-handoffs:3}") int maxHandoffs
    ) {
        this.maximum = new RunBudget(
            maxDurationSeconds,
            maxModelCalls,
            maxToolCalls,
            maxInputTokens,
            maxOutputTokens,
            maxDepartments,
            maxHierarchyDepth,
            maxSearchCredits,
            maxRetries,
            maxHandoffs
        );
    }

    public void enforce(RunBudget requested) {
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
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_CONTENT, "Agent run budget exceeds workspace policy");
        }
    }
}
