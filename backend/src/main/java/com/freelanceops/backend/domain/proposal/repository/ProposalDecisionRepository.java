package com.freelanceops.backend.domain.proposal.repository;

import com.freelanceops.backend.domain.proposal.entity.ProposalDecisionEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface ProposalDecisionRepository extends JpaRepository<ProposalDecisionEntity, UUID> {
    boolean existsByShareId(UUID shareId);
}
