package com.freelanceops.backend.domain.analysisdecision.dto.response;

import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView;
import java.util.UUID;

public record AnalysisSourceResponse(UUID runId, Long sourceProjectVersion, AgentRunView view) { }
