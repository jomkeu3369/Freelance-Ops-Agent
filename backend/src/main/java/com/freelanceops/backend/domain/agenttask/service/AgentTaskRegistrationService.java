package com.freelanceops.backend.domain.agenttask.service;

import com.freelanceops.backend.domain.agenttask.dto.request.AgentTaskExecutionProfileRequest;
import com.freelanceops.backend.domain.agenttask.entity.AgentTaskAttemptEntity;
import com.freelanceops.backend.domain.agenttask.entity.AgentTaskEntity;
import com.freelanceops.backend.domain.agenttask.entity.AgentTaskExecutionProfileEntity;
import com.freelanceops.backend.domain.agenttask.repository.AgentTaskExecutionProfileRepository;
import com.freelanceops.backend.domain.internaltool.security.DelegationPrincipal;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Collection;
import java.util.Map;
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
    public RegistrationResult register(AgentTaskEntity task, Collection<UUID> dependencies,
                                       AgentTaskExecutionProfileRequest profile,
                                       UUID attemptId, Double predictedSeconds, String predictionModelVersion,
                                       Map<String, Object> predictionFeatureSnapshot,
                                       DelegationPrincipal principal, Instant now) {
        AgentTaskExecutionProfileEntity validated = guard.validate(task, profile, principal, now);
        AgentTaskEntity registered = registry.register(task, dependencies, now);
        AgentTaskExecutionProfileEntity stored = profileRepository.findById(validated.id())
            .map(existing -> requireSameProfile(existing, validated))
            .orElseGet(() -> profileRepository.saveAndFlush(validated));
        AgentTaskAttemptEntity attempt = registry.createAttempt(registered.id(), registered.workspaceId(),
            registered.revision(), attemptId, predictedSeconds, predictionModelVersion,
            predictionFeatureSnapshot, now);
        return new RegistrationResult(registered, attempt, stored);
    }

    private static AgentTaskExecutionProfileEntity requireSameProfile(AgentTaskExecutionProfileEntity existing,
                                                                       AgentTaskExecutionProfileEntity requested) {
        if (!existing.hasSameContract(requested)) {
            throw new IllegalStateException("task execution profile conflicts with existing registration");
        }
        return existing;
    }

    public record RegistrationResult(AgentTaskEntity task, AgentTaskAttemptEntity attempt,
                                     AgentTaskExecutionProfileEntity profile) {
    }
}
