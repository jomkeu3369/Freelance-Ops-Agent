package com.freelanceops.backend.domain.workspace.repository;

import com.freelanceops.backend.domain.workspace.entity.RbacAuditEventEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface RbacAuditEventRepository extends JpaRepository<RbacAuditEventEntity, UUID> {
}


