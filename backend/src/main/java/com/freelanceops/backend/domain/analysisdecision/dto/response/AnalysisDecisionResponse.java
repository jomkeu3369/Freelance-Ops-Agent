package com.freelanceops.backend.domain.analysisdecision.dto.response;

import com.freelanceops.backend.domain.agentrun.dto.PetProfile;
import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView.QuotationDraft;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Both the original composition and each user edit remain independently readable. */
public record AnalysisDecisionResponse(
    UUID id, UUID workspaceId, UUID projectId, UUID familyId, UUID previousId,
    int versionNumber, String status, UUID sourceRunId, long sourceProjectVersion,
    List<String> selectedOpinionIds, List<OpinionSnapshot> sourceOpinions,
    List<PetProfile> sourcePetProfiles, String sourceSummary, List<String> sourceOpenQuestions,
    List<String> reviewWarnings, String originalBodyText, String bodyText, String contentHash,
    String bodyOrigin, UUID createdBy, Instant createdAt, UUID confirmedBy, Instant confirmedAt
) {
    public record OpinionSnapshot(String opinionId, String scenario, QuotationDraft draft) { }
}
