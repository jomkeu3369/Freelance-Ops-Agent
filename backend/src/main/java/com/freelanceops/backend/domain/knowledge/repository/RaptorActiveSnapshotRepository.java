package com.freelanceops.backend.domain.knowledge.repository;

import com.freelanceops.backend.domain.knowledge.entity.RaptorActiveSnapshotEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.UUID;

public interface RaptorActiveSnapshotRepository extends JpaRepository<RaptorActiveSnapshotEntity, UUID> {
}
