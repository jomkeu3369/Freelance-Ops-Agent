package com.freelanceops.backend.domain.internaltool.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Entity
@Table(name = "domain_pack", schema = "app")
public class DomainPackEntity {

    @Id
    private UUID id;

    @Column(nullable = false, length = 64)
    private String code;

    @Column(nullable = false, length = 100)
    private String version;

    @Column(name = "jurisdiction_code", nullable = false, length = 32)
    private String jurisdictionCode;

    @Column(name = "profession_code", nullable = false, length = 64)
    private String professionCode;

    @Column(nullable = false, length = 10000)
    private String scope;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "required_fields", nullable = false, columnDefinition = "jsonb")
    private List<String> requiredFields;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "question_templates", nullable = false, columnDefinition = "jsonb")
    private List<String> questionTemplates;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "source_references", nullable = false, columnDefinition = "jsonb")
    private List<Map<String, String>> sourceReferences;

    @Column(name = "effective_from", nullable = false)
    private LocalDate effectiveFrom;

    @Column(name = "effective_until")
    private LocalDate effectiveUntil;

    @Column(nullable = false)
    private boolean active;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    protected DomainPackEntity() {
    }

    public String code() { return code; }
    public String version() { return version; }
    public String jurisdictionCode() { return jurisdictionCode; }
    public String professionCode() { return professionCode; }
    public String scope() { return scope; }
    public List<String> requiredFields() { return List.copyOf(requiredFields); }
    public List<String> questionTemplates() { return List.copyOf(questionTemplates); }
    public List<Map<String, String>> sourceReferences() { return List.copyOf(sourceReferences); }
    public LocalDate effectiveFrom() { return effectiveFrom; }
    public LocalDate effectiveUntil() { return effectiveUntil; }
    public boolean active() { return active; }
}
