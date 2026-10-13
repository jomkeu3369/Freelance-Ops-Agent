package com.freelanceops.backend.domain.specification.service;

import com.freelanceops.backend.domain.analysisdecision.service.AnalysisDecisionService;
import com.freelanceops.backend.domain.specification.model.ConfirmedAnalysisSource;
import org.springframework.stereotype.Component;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;
import java.util.Map;
import java.util.UUID;

/** Never accepts client-supplied text as the confirmed source. */
@Component
public class AnalysisDecisionSpecificationSource implements SpecificationSourceReader {
    private final AnalysisDecisionService decisions;
    private final ObjectMapper mapper;
    public AnalysisDecisionSpecificationSource(AnalysisDecisionService decisions, ObjectMapper mapper) {
        this.decisions = decisions; this.mapper = mapper;
    }

    @Override
    public ConfirmedAnalysisSource getConfirmed(UUID userId, UUID workspaceId, UUID projectId, UUID decisionId) {
        var source = decisions.getCurrentConfirmed(userId, workspaceId, projectId, decisionId);
        Map<String, Object> provenance = mapper.convertValue(source, new TypeReference<>() {});
        return new ConfirmedAnalysisSource(source.id(), source.versionNumber(), source.bodyText(), source.contentHash(),
            source.sourceRunId(), source.sourceProjectVersion(), source.selectedOpinionIds(), provenance,
            source.confirmedBy(), source.confirmedAt());
    }

    @Override
    public boolean isLatestConfirmed(UUID userId, UUID workspaceId, UUID projectId, UUID decisionId) {
        return decisions.isCurrentConfirmed(userId, workspaceId, projectId, decisionId)
            && latestConfirmedId(userId, workspaceId, projectId).map(decisionId::equals).orElse(false);
    }

    @Override
    public java.util.Optional<UUID> latestConfirmedId(UUID userId, UUID workspaceId, UUID projectId) {
        return decisions.getLatestConfirmed(userId, workspaceId, projectId).map(source -> source.id());
    }
}
