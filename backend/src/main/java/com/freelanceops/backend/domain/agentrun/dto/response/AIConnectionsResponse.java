package com.freelanceops.backend.domain.agentrun.dto.response;

import com.freelanceops.backend.domain.agentrun.model.Provider;

import io.swagger.v3.oas.annotations.media.Schema;

import java.util.List;
import java.util.Map;

@Schema(name = "Connections")
public record AIConnectionsResponse(
        boolean available,
        Map<Provider, List<String>> models,
        List<AIConnectionResponse> connections) {}
