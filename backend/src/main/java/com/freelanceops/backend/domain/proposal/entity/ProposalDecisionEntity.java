package com.freelanceops.backend.domain.proposal.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "quotation_decision", schema = "app")
public class ProposalDecisionEntity {

    @Id
    private UUID id;

    @Column(name = "workspace_id", nullable = false)
    private UUID workspaceId;

    @Column(name = "quotation_id", nullable = false)
    private UUID quotationId;

    @Column(name = "share_id", nullable = false)
    private UUID shareId;

    @Column(nullable = false, length = 30)
    private String decision;

    @Column(length = 3000)
    private String comment;

    @Column(name = "client_name", nullable = false, length = 120)
    private String clientName;

    @Column(name = "client_email", length = 320)
    private String clientEmail;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    protected ProposalDecisionEntity() {
    }

    public ProposalDecisionEntity(UUID id, UUID workspaceId, UUID quotationId, UUID shareId, String decision, String comment, String clientName, String clientEmail, Instant createdAt) {
        this.id = id;
        this.workspaceId = workspaceId;
        this.quotationId = quotationId;
        this.shareId = shareId;
        this.decision = decision;
        this.comment = comment;
        this.clientName = clientName;
        this.clientEmail = clientEmail;
        this.createdAt = createdAt;
    }

    public UUID id() { return id; }
    public UUID workspaceId() { return workspaceId; }
    public UUID quotationId() { return quotationId; }
    public UUID shareId() { return shareId; }
    public String decision() { return decision; }
    public String comment() { return comment; }
    public String clientName() { return clientName; }
    public String clientEmail() { return clientEmail; }
    public Instant createdAt() { return createdAt; }
}
