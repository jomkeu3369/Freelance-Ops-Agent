package com.freelanceops.backend.domain.workspace.repository;

import com.freelanceops.backend.domain.workspace.policy.AuthorizationAuditEvent;

public interface AuthorizationAuditSink {

    void record(AuthorizationAuditEvent event);
}


