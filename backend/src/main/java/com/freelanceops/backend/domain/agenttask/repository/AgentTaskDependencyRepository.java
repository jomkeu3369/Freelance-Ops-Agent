package com.freelanceops.backend.domain.agenttask.repository;

import com.freelanceops.backend.domain.agenttask.entity.AgentTaskDependencyEntity;
import com.freelanceops.backend.domain.agenttask.entity.AgentTaskDependencyId;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.UUID;

public interface AgentTaskDependencyRepository extends JpaRepository<AgentTaskDependencyEntity, AgentTaskDependencyId> {

    @Query("select dependency from AgentTaskDependencyEntity dependency where dependency.id.taskId = :taskId")
    List<AgentTaskDependencyEntity> findAllByTaskId(@Param("taskId") UUID taskId);
}
