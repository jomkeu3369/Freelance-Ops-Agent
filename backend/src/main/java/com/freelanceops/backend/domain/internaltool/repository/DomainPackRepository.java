package com.freelanceops.backend.domain.internaltool.repository;

import com.freelanceops.backend.domain.internaltool.entity.DomainPackEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.LocalDate;
import java.util.Optional;
import java.util.UUID;

public interface DomainPackRepository extends JpaRepository<DomainPackEntity, UUID> {
    Optional<DomainPackEntity> findFirstByCodeIgnoreCaseAndJurisdictionCodeAndActiveTrueAndEffectiveFromLessThanEqualOrderByEffectiveFromDesc(
        String code,
        String jurisdictionCode,
        LocalDate effectiveOn
    );
}
