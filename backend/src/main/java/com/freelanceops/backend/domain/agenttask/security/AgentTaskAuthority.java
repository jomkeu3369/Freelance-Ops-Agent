package com.freelanceops.backend.domain.agenttask.security;

import com.freelanceops.backend.domain.internaltool.security.DelegationPrincipal;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

@Component
public class AgentTaskAuthority {

    public void requireControl(DelegationPrincipal principal) {
        if (!principal.permissions().contains("agent.run")) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "agent.run permission is required");
        }
    }

    public void requireReport(DelegationPrincipal principal) {
        if (!principal.permissions().contains("agent.run") && !principal.permissions().contains("agent.task.report")) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "task report permission is required");
        }
    }
}
