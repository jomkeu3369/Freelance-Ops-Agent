package com.freelanceops.backend.workspace.application;

public interface AuthorizationAuditSink {

    void record(AuthorizationAuditEvent event);
}
