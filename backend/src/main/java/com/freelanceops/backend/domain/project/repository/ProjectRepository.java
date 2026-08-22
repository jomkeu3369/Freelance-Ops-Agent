package com.freelanceops.backend.domain.project.repository;

import com.freelanceops.backend.domain.project.entity.ProjectEntity;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface ProjectRepository extends JpaRepository<ProjectEntity, UUID> {

    Optional<ProjectEntity> findByIdAndWorkspaceId(UUID id, UUID workspaceId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select project from ProjectEntity project where project.id = :id and project.workspaceId = :workspaceId")
    Optional<ProjectEntity> findByIdAndWorkspaceIdForUpdate(@Param("id") UUID id, @Param("workspaceId") UUID workspaceId);

    List<ProjectEntity> findAllByWorkspaceIdOrderByUpdatedAtDesc(UUID workspaceId);

    @Query("""
        select project
        from ProjectEntity project
        where project.workspaceId = :workspaceId
          and (
            lower(project.title) like :search
            or exists (
              select client.id
              from ClientEntity client
              where client.id = project.clientId
                and client.workspaceId = :workspaceId
                and (
                  lower(client.name) like :search
                  or lower(coalesce(client.companyName, '')) like :search
                )
            )
          )
        order by project.updatedAt desc
        """)
    List<ProjectEntity> searchByWorkspaceId(@Param("workspaceId") UUID workspaceId, @Param("search") String search);
}


