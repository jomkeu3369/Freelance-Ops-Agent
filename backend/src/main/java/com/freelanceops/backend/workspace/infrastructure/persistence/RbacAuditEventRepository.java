package com.freelanceops.backend.workspace.infrastructure.persistence;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface RbacAuditEventRepository extends JpaRepository<RbacAuditEventEntity, UUID> {
}
