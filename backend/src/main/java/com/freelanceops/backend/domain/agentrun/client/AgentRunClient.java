package com.freelanceops.backend.domain.agentrun.client;

import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView;
import com.freelanceops.backend.domain.agentrun.client.dto.request.InternalAgentRunRequest;
import com.freelanceops.backend.domain.agentrun.dto.request.ResumeAgentRunRequest;
import com.freelanceops.backend.domain.agentrun.dto.response.StartAgentRunResponse;

import java.util.UUID;

public interface AgentRunClient {

    StartAgentRunResponse start(InternalAgentRunRequest request, String delegationToken, String traceparent);

    AgentRunView get(UUID runId, String delegationToken, String traceparent);

    StartAgentRunResponse resume(UUID runId, ResumeAgentRunRequest request, String delegationToken, String traceparent);

    AgentRunView cancel(UUID runId, String delegationToken, String traceparent);

    AgentEventStream events(UUID runId, Long lastEventId, String delegationToken, String traceparent);
}


