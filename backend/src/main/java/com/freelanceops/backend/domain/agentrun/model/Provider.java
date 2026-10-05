package com.freelanceops.backend.domain.agentrun.model;

public enum Provider {
    OPENAI,
    // Retained for stored run, pricing, task and connection history only.
    GEMINI;

    public boolean supported() { return this == OPENAI; }
}
