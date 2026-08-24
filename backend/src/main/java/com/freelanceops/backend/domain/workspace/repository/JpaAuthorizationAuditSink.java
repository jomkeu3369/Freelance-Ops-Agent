package com.freelanceops.backend.domain.workspace.repository;

import com.freelanceops.backend.domain.workspace.policy.AuthorizationAuditEvent;
import com.freelanceops.backend.domain.workspace.repository.AuthorizationAuditSink;
import com.freelanceops.backend.domain.workspace.entity.RbacAuditEventEntity;
import com.freelanceops.backend.domain.workspace.repository.RbacAuditEventRepository;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Repository
public class JpaAuthorizationAuditSink implements AuthorizationAuditSink {

    private final RbacAuditEventRepository auditEventRepository;

    public JpaAuthorizationAuditSink(RbacAuditEventRepository auditEventRepository) {
        this.auditEventRepository = auditEventRepository;
    }

    @Override
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void record(AuthorizationAuditEvent event) {
        auditEventRepository.save(RbacAuditEventEntity.authorizationCheck(event));
    }
}


