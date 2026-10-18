package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest.RunBudget;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

@Component
public class AgentBudgetPolicy {

    // 사용자가 선택한 개인 키에만 적용하는 상한이다. 공용 한도나 별도 작업 실행 설정에 적용하지 않는다.
    private static final int PERSONAL_MAX_INPUT_TOKENS = 150000;
    private final RunBudget maximum;

    public AgentBudgetPolicy(
            @Value("${agent.quota.max-duration-seconds:180}") int maxDurationSeconds,
            @Value("${agent.quota.max-model-calls:50}") int maxModelCalls,
            @Value("${agent.quota.max-tool-calls:12}") int maxToolCalls,
            @Value("${agent.quota.max-input-tokens:100000}") int maxInputTokens,
            @Value("${agent.quota.max-output-tokens:48000}") int maxOutputTokens,
            @Value("${agent.quota.max-departments:4}") int maxDepartments,
            @Value("${agent.quota.max-hierarchy-depth:2}") int maxHierarchyDepth,
            @Value("${agent.quota.max-search-credits:2}") int maxSearchCredits,
            @Value("${agent.quota.max-retries:2}") int maxRetries,
            @Value("${agent.quota.max-handoffs:3}") int maxHandoffs) {
        this.maximum =
                new RunBudget(
                        maxDurationSeconds,
                        maxModelCalls,
                        maxToolCalls,
                        maxInputTokens,
                        maxOutputTokens,
                        maxDepartments,
                        maxHierarchyDepth,
                        maxSearchCredits,
                        maxRetries,
                        maxHandoffs);
    }

    public void enforce(RunBudget requested) {
        enforce(requested, maximum.maxInputTokens());
    }

    /** 개인 키의 현재 사용 권한을 확인한 뒤 실행 범위 발급 과정에서만 호출한다. */
    void enforcePersonal(RunBudget requested) {
        // 비용 안내에서 승인한 상한은 운영 설정으로 늘릴 수 없다. 나머지 한도는 공용 정책의 더 낮은 값을 따른다.
        if (requested.maxDurationSeconds() > 180
                || requested.maxModelCalls() > 50
                || requested.maxOutputTokens() > 48000) {
            throw new ResponseStatusException(
                    HttpStatus.UNPROCESSABLE_CONTENT,
                    "Personal execution budget exceeds the approved cost notice policy");
        }
        enforce(requested, PERSONAL_MAX_INPUT_TOKENS);
    }

    private void enforce(RunBudget requested, int maxInputTokens) {
        if (requested.maxDurationSeconds() > maximum.maxDurationSeconds()
                || requested.maxModelCalls() > maximum.maxModelCalls()
                || requested.maxToolCalls() > maximum.maxToolCalls()
                || requested.maxInputTokens() > maxInputTokens
                || requested.maxOutputTokens() > maximum.maxOutputTokens()
                || requested.maxDepartments() > maximum.maxDepartments()
                || requested.maxHierarchyDepth() > maximum.maxHierarchyDepth()
                || requested.maxSearchCredits() > maximum.maxSearchCredits()
                || requested.maxRetries() > maximum.maxRetries()
                || requested.maxHandoffs() > maximum.maxHandoffs()) {
            throw new ResponseStatusException(
                    HttpStatus.UNPROCESSABLE_CONTENT, "Agent run budget exceeds workspace policy");
        }
    }
}
