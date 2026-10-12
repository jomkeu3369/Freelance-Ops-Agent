package com.freelanceops.backend.domain.quotation.repository;

import com.freelanceops.backend.domain.quotation.entity.QuotationEntity;
import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface QuotationRepository extends JpaRepository<QuotationEntity, UUID> {
    List<QuotationEntity> findAllByWorkspaceIdAndProjectIdOrderByCreatedAtDescIdDesc(UUID workspaceId, UUID projectId);

    @Query("select quotation from QuotationEntity quotation where quotation.workspaceId = :workspaceId and quotation.projectId = :projectId order by quotation.createdAt desc, quotation.id desc")
    List<QuotationEntity> findFirstPage(@Param("workspaceId") UUID workspaceId, @Param("projectId") UUID projectId, Pageable pageable);

    // PostgreSQL row comparison keeps the entire cursor boundary in the index range.
    // The equivalent OR predicate filters earlier rows on deep pages instead.
    @Query(value = "select q.* from app.quotation q where q.workspace_id = :workspaceId and q.project_id = :projectId and (q.created_at, q.id) < (:createdAt, :id) order by q.created_at desc, q.id desc", nativeQuery = true)
    List<QuotationEntity> findNextPage(@Param("workspaceId") UUID workspaceId, @Param("projectId") UUID projectId, @Param("createdAt") Instant createdAt, @Param("id") UUID id, Pageable pageable);
    Optional<QuotationEntity> findByIdAndWorkspaceId(UUID id, UUID workspaceId);
    Optional<QuotationEntity> findTopByWorkspaceIdAndSeriesIdOrderByVersionNumberDesc(UUID workspaceId, UUID seriesId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select quotation from QuotationEntity quotation where quotation.id = :id and quotation.workspaceId = :workspaceId")
    Optional<QuotationEntity> findByIdAndWorkspaceIdForUpdate(@Param("id") UUID id, @Param("workspaceId") UUID workspaceId);
}
