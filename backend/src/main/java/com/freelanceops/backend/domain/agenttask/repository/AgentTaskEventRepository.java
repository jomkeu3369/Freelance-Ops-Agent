package com.freelanceops.backend.domain.agenttask.repository;

import com.freelanceops.backend.domain.agenttask.entity.AgentTaskEventEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface AgentTaskEventRepository extends JpaRepository<AgentTaskEventEntity, String> {

    @Query("""
        select event from AgentTaskEventEntity event
        where event.eventId = :eventId
           or (event.source = :source and event.sourceEventId = :sourceEventId)
           or (event.attemptId = :attemptId and event.sequence = :sequence)
        """)
    List<AgentTaskEventEntity> findConflicts(
        @Param("eventId") String eventId,
        @Param("source") String source,
        @Param("sourceEventId") String sourceEventId,
        @Param("attemptId") java.util.UUID attemptId,
        @Param("sequence") int sequence
    );
}
