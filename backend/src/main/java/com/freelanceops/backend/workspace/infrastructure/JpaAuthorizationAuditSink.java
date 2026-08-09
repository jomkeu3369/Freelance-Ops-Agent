package com.freelanceops.backend.workspace.infrastructure;

import com.freelanceops.backend.workspace.application.AuthorizationAuditEvent;
import com.freelanceops.backend.workspace.application.AuthorizationAuditSink;
import com.freelanceops.backend.workspace.infrastructure.persistence.RbacAuditEventEntity;
import com.freelanceops.backend.workspace.infrastructure.persistence.RbacAuditEventRepository;
import org.springframework.stereotype.Repository;

@Repository
public class JpaAuthorizationAuditSink implements AuthorizationAuditSink {

    private final RbacAuditEventRepository auditEventRepository;

    public JpaAuthorizationAuditSink(RbacAuditEventRepository auditEventRepository) {
        this.auditEventRepository = auditEventRepository;
    }

    @Override
    public void record(AuthorizationAuditEvent event) {
        auditEventRepository.save(RbacAuditEventEntity.authorizationCheck(event));
    }
}
