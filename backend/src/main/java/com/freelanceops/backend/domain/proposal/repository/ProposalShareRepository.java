package com.freelanceops.backend.domain.proposal.repository;

import com.freelanceops.backend.domain.proposal.entity.ProposalShareEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface ProposalShareRepository extends JpaRepository<ProposalShareEntity, UUID> {
    Optional<ProposalShareEntity> findByTokenHash(String tokenHash);
    Optional<ProposalShareEntity> findByIdAndWorkspaceId(UUID id, UUID workspaceId);
}
