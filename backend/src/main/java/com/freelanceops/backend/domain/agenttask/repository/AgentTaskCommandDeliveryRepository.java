package com.freelanceops.backend.domain.agenttask.repository;

import com.freelanceops.backend.domain.agenttask.entity.AgentTaskCommandDeliveryEntity;
import com.freelanceops.backend.domain.agenttask.model.AgentTaskCommandDeliveryStatus;
import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import java.util.Optional;

public interface AgentTaskCommandDeliveryRepository extends JpaRepository<AgentTaskCommandDeliveryEntity, UUID> {

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select delivery from AgentTaskCommandDeliveryEntity delivery where delivery.commandId = :commandId")
    Optional<AgentTaskCommandDeliveryEntity> findByIdForUpdate(@Param("commandId") UUID commandId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
        select delivery from AgentTaskCommandDeliveryEntity delivery
        where delivery.status in :statuses
          and delivery.availableAt <= :now
          and (delivery.status <> com.freelanceops.backend.domain.agenttask.model.AgentTaskCommandDeliveryStatus.PROCESSING
               or delivery.leaseUntil <= :now)
        order by delivery.availableAt, delivery.createdAt
        """)
    List<AgentTaskCommandDeliveryEntity> findClaimableForUpdate(
        @Param("statuses") Collection<AgentTaskCommandDeliveryStatus> statuses,
        @Param("now") Instant now,
        Pageable pageable
    );
}
