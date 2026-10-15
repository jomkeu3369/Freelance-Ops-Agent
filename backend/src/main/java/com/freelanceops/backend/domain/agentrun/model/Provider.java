package com.freelanceops.backend.domain.agentrun.model;

public enum Provider {
    OPENAI,
    // 저장된 실행·가격·작업·연결 이력을 읽기 위해 유지한다.
    GEMINI;

    public boolean supported() {
        return this == OPENAI;
    }
}
