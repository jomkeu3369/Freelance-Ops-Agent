package com.freelanceops.backend.domain.agentrun.model;

/** 실행 및 작업 프로필에 보존하는 한도. HTTP 요청의 검증 제약과는 독립적이다. */
public record AgentRunBudget(
        int maxDurationSeconds,
        int maxModelCalls,
        int maxToolCalls,
        int maxInputTokens,
        int maxOutputTokens,
        int maxDepartments,
        int maxHierarchyDepth,
        int maxSearchCredits,
        int maxRetries,
        int maxHandoffs) {}
