package com.freelanceops.backend.domain.knowledge.client;

import com.freelanceops.backend.domain.knowledge.client.dto.request.RaptorBuildRequest;
import com.freelanceops.backend.domain.knowledge.client.dto.response.RaptorBuildResponse;

public interface RaptorBuildClient {
    RaptorBuildResponse build(RaptorBuildRequest request, String delegationToken, String traceparent);
}
