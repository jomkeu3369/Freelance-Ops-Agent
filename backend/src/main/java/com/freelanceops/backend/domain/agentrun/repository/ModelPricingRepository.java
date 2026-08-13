package com.freelanceops.backend.domain.agentrun.repository;

import com.freelanceops.backend.domain.agentrun.entity.ModelPricingEntity;
import com.freelanceops.backend.domain.agentrun.model.Provider;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public interface ModelPricingRepository extends JpaRepository<ModelPricingEntity, UUID> {
    List<ModelPricingEntity> findAllByWorkspaceIdOrderByValidFromDesc(UUID workspaceId);

    @Query("""
        select pricing from ModelPricingEntity pricing
        where pricing.workspaceId = :workspaceId
          and pricing.provider = :provider
          and pricing.model = :model
          and pricing.validFrom <= :at
          and (pricing.validUntil is null or pricing.validUntil > :at)
        order by pricing.validFrom desc
        """)
    List<ModelPricingEntity> findApplicable(UUID workspaceId, Provider provider, String model, Instant at);
}
