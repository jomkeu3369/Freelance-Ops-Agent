package com.freelanceops.backend.domain.agentrun.dto.response;

public record WilsonIntervalResponse(
    long errors,
    long total,
    double estimate,
    double lower,
    double upper,
    String decision
) {
}
