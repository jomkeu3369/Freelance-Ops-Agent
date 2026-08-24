package com.freelanceops.backend.domain.proposal.repository;

import com.freelanceops.backend.domain.proposal.entity.ProposalShareEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import jakarta.persistence.LockModeType;

import java.util.Optional;
import java.util.UUID;

public interface ProposalShareRepository extends JpaRepository<ProposalShareEntity, UUID> {
    Optional<ProposalShareEntity> findByTokenHash(String tokenHash);
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select share from ProposalShareEntity share where share.tokenHash = :tokenHash")
    Optional<ProposalShareEntity> findByTokenHashForUpdate(@Param("tokenHash") String tokenHash);
    Optional<ProposalShareEntity> findByIdAndWorkspaceId(UUID id, UUID workspaceId);
}
