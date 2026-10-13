package com.freelanceops.backend.domain.analysisdecision.entity;

import com.freelanceops.backend.domain.agentrun.dto.PetProfile;
import com.freelanceops.backend.domain.analysisdecision.dto.response.AnalysisDecisionResponse;
import com.freelanceops.backend.domain.analysisdecision.dto.response.AnalysisDecisionResponse.OpinionSnapshot;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "analysis_decision", schema = "app")
public class AnalysisDecisionEntity {
    @Id private UUID id;
    @Column(name = "workspace_id", nullable = false) private UUID workspaceId;
    @Column(name = "project_id", nullable = false) private UUID projectId;
    @Column(name = "family_id", nullable = false) private UUID familyId;
    @Column(name = "previous_id") private UUID previousId;
    @Column(name = "version_number", nullable = false) private int versionNumber;
    @Column(nullable = false) private String status;
    @Column(name = "source_run_id", nullable = false) private UUID sourceRunId;
    @Column(name = "source_project_version", nullable = false) private long sourceProjectVersion;
    @JdbcTypeCode(SqlTypes.JSON) @Column(name = "selected_opinion_ids", nullable = false, columnDefinition = "jsonb") private List<String> selectedOpinionIds;
    @JdbcTypeCode(SqlTypes.JSON) @Column(name = "source_opinions", nullable = false, columnDefinition = "jsonb") private List<OpinionSnapshot> sourceOpinions;
    @JdbcTypeCode(SqlTypes.JSON) @Column(name = "source_pet_profiles", nullable = false, columnDefinition = "jsonb") private List<PetProfile> sourcePetProfiles;
    @Column(name = "source_summary", nullable = false, columnDefinition = "text") private String sourceSummary;
    @JdbcTypeCode(SqlTypes.JSON) @Column(name = "source_open_questions", nullable = false, columnDefinition = "jsonb") private List<String> sourceOpenQuestions;
    @JdbcTypeCode(SqlTypes.JSON) @Column(name = "review_warnings", nullable = false, columnDefinition = "jsonb") private List<String> reviewWarnings;
    @Column(name = "original_body_text", nullable = false, columnDefinition = "text") private String originalBodyText;
    @Column(name = "body_text", nullable = false, columnDefinition = "text") private String bodyText;
    @Column(name = "content_hash", nullable = false, length = 64) private String contentHash;
    @Column(name = "body_origin", nullable = false) private String bodyOrigin;
    @Column(name = "request_id", nullable = false) private UUID requestId;
    @Column(name = "operation_hash", nullable = false, length = 64) private String operationHash;
    @Column(name = "created_by", nullable = false) private UUID createdBy;
    @Column(name = "created_at", nullable = false) private Instant createdAt;
    @Column(name = "confirmed_by") private UUID confirmedBy;
    @Column(name = "confirmed_at") private Instant confirmedAt;
    @Version private long version;

    protected AnalysisDecisionEntity() { }

    public AnalysisDecisionEntity(UUID id, UUID workspaceId, UUID projectId, UUID sourceRunId,
        long sourceProjectVersion, List<OpinionSnapshot> opinions, List<PetProfile> petProfiles,
        String sourceSummary, List<String> openQuestions, List<String> warnings,
        String body, String hash, UUID requestId, String operationHash, UUID actor, Instant now) {
        this.id = id; this.workspaceId = workspaceId; this.projectId = projectId;
        this.familyId = id; this.versionNumber = 1; this.status = "DRAFT";
        this.sourceRunId = sourceRunId; this.sourceProjectVersion = sourceProjectVersion;
        this.sourceOpinions = List.copyOf(opinions);
        this.selectedOpinionIds = opinions.stream().map(OpinionSnapshot::opinionId).toList();
        this.sourcePetProfiles = List.copyOf(petProfiles); this.sourceSummary = sourceSummary;
        this.sourceOpenQuestions = List.copyOf(openQuestions); this.reviewWarnings = List.copyOf(warnings);
        this.originalBodyText = body; this.bodyText = body; this.contentHash = hash;
        this.bodyOrigin = "SELECTED_OPINIONS"; this.createdBy = actor; this.createdAt = now;
        this.requestId = requestId; this.operationHash = operationHash;
    }

    public AnalysisDecisionEntity revised(UUID nextId, String body, String hash, UUID requestId,
        String operationHash, UUID actor, Instant now) {
        AnalysisDecisionEntity next = new AnalysisDecisionEntity(nextId, workspaceId, projectId, sourceRunId,
            sourceProjectVersion, sourceOpinions, sourcePetProfiles, sourceSummary, sourceOpenQuestions,
            reviewWarnings, originalBodyText, contentHash, requestId, operationHash, actor, now);
        next.familyId = familyId; next.previousId = id; next.versionNumber = versionNumber + 1;
        next.bodyText = body; next.contentHash = hash; next.bodyOrigin = "USER_EDITED";
        return next;
    }

    public void confirm(UUID actor, Instant now) {
        if (!"DRAFT".equals(status)) throw new IllegalStateException("Only a draft can be confirmed");
        status = "CONFIRMED"; confirmedBy = actor; confirmedAt = now;
    }

    public UUID id() { return id; }
    public UUID familyId() { return familyId; }
    public String status() { return status; }
    public long sourceProjectVersion() { return sourceProjectVersion; }
    public String contentHash() { return contentHash; }
    public String bodyText() { return bodyText; }
    public String operationHash() { return operationHash; }

    public AnalysisDecisionResponse response() {
        return new AnalysisDecisionResponse(id, workspaceId, projectId, familyId, previousId,
            versionNumber, status, sourceRunId, sourceProjectVersion, selectedOpinionIds, sourceOpinions,
            sourcePetProfiles, sourceSummary, sourceOpenQuestions, reviewWarnings, originalBodyText,
            bodyText, contentHash, bodyOrigin, createdBy, createdAt, confirmedBy, confirmedAt);
    }
}
