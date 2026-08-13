package com.freelanceops.backend.domain.quotation.repository;

import com.freelanceops.backend.domain.quotation.entity.QuotationEntity;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface QuotationRepository extends JpaRepository<QuotationEntity, UUID> {
    List<QuotationEntity> findAllByWorkspaceIdAndProjectIdOrderByCreatedAtDesc(UUID workspaceId, UUID projectId);
    Optional<QuotationEntity> findByIdAndWorkspaceId(UUID id, UUID workspaceId);
    Optional<QuotationEntity> findTopByWorkspaceIdAndSeriesIdOrderByVersionNumberDesc(UUID workspaceId, UUID seriesId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select quotation from QuotationEntity quotation where quotation.id = :id and quotation.workspaceId = :workspaceId")
    Optional<QuotationEntity> findByIdAndWorkspaceIdForUpdate(@Param("id") UUID id, @Param("workspaceId") UUID workspaceId);
}
