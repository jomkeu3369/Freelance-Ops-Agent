package com.freelanceops.backend.domain.client.repository;

import com.freelanceops.backend.domain.client.entity.ClientEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface ClientRepository extends JpaRepository<ClientEntity, UUID> {
    List<ClientEntity> findAllByWorkspaceIdAndStatusOrderByUpdatedAtDesc(UUID workspaceId, String status);
    Optional<ClientEntity> findByIdAndWorkspaceId(UUID id, UUID workspaceId);
}
