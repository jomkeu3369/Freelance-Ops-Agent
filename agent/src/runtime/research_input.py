"""Stable reference validation for Research input stored in AgentRun state."""

import hashlib
import json

from contracts import AgentRunRequest


def research_input_digest(request: AgentRunRequest) -> str:
    value = {"input": request.input.model_dump(mode="json"), "model": request.model_selection.model_dump(mode="json")}
    canonical = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()
