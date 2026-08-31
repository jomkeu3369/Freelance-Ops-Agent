package com.freelanceops.backend.domain.agenttask.service;

import com.freelanceops.backend.domain.agenttask.dto.request.AgentTaskExecutionProfileRequest;
import com.freelanceops.backend.domain.agenttask.entity.AgentTaskEntity;
import com.freelanceops.backend.domain.agenttask.entity.AgentTaskExecutionProfileEntity;
import com.freelanceops.backend.domain.agenttask.repository.AgentTaskExecutionProfileRepository;
import com.freelanceops.backend.domain.internaltool.security.DelegationPrincipal;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Collection;
import java.util.UUID;

@Service
public class AgentTaskRegistrationService {

    private final AgentTaskRegistry registry;
    private final AgentTaskGuard guard;
    private final AgentTaskExecutionProfileRepository profileRepository;

    public AgentTaskRegistrationService(AgentTaskRegistry registry, AgentTaskGuard guard,
                                        AgentTaskExecutionProfileRepository profileRepository) {
        this.registry = registry;
        this.guard = guard;
        this.profileRepository = profileRepository;
    }

    @Transactional
    public AgentTaskEntity register(AgentTaskEntity task, Collection<UUID> dependencies,
                                    AgentTaskExecutionProfileRequest profile,
                                    DelegationPrincipal principal, Instant now) {
        AgentTaskExecutionProfileEntity validated = guard.validate(task, profile, principal, now);
        AgentTaskEntity registered = registry.register(task, dependencies, now);
        profileRepository.saveAndFlush(validated);
        return registered;
    }
}
