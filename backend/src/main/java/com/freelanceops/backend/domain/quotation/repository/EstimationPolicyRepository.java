package com.freelanceops.backend.domain.quotation.repository;

import com.freelanceops.backend.domain.quotation.entity.EstimationPolicyEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.UUID;

public interface EstimationPolicyRepository extends JpaRepository<EstimationPolicyEntity, UUID> {
}
