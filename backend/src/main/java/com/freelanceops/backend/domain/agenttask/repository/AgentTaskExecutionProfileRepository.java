package com.freelanceops.backend.domain.agenttask.repository;

import com.freelanceops.backend.domain.agenttask.entity.AgentTaskExecutionProfileEntity;
import com.freelanceops.backend.domain.agenttask.entity.AgentTaskExecutionProfileId;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AgentTaskExecutionProfileRepository
    extends JpaRepository<AgentTaskExecutionProfileEntity, AgentTaskExecutionProfileId> {
}
