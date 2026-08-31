package com.freelanceops.backend.domain.agenttask.repository;

import com.freelanceops.backend.domain.agenttask.entity.AgentTaskDependencyEntity;
import com.freelanceops.backend.domain.agenttask.entity.AgentTaskDependencyId;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AgentTaskDependencyRepository extends JpaRepository<AgentTaskDependencyEntity, AgentTaskDependencyId> {
}
