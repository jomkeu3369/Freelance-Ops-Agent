package com.freelanceops.backend.domain.outcome.service;

import com.freelanceops.backend.domain.outcome.dto.request.UpsertActualOutcomeRequest;
import com.freelanceops.backend.domain.outcome.dto.response.ActualOutcomeResponse;
import com.freelanceops.backend.domain.outcome.dto.response.ActualWorkItemResponse;
import com.freelanceops.backend.domain.outcome.entity.ActualOutcomeEntity;
import com.freelanceops.backend.domain.outcome.entity.ActualWorkItemEntity;
import com.freelanceops.backend.domain.outcome.repository.ActualOutcomeRepository;
import com.freelanceops.backend.domain.outcome.repository.ActualWorkItemRepository;
import com.freelanceops.backend.domain.project.repository.ProjectRepository;
import com.freelanceops.backend.domain.quotation.entity.QuotationEntity;
import com.freelanceops.backend.domain.quotation.repository.QuotationItemRepository;
import com.freelanceops.backend.domain.quotation.repository.QuotationRepository;
import com.freelanceops.backend.domain.workspace.policy.AuthorizationDecision;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import com.freelanceops.backend.domain.workspace.service.WorkspaceAuthorizationService;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Service
public class ActualOutcomeService {
    private final ProjectRepository projectRepository;
    private final QuotationRepository quotationRepository;
    private final QuotationItemRepository quotationItemRepository;
    private final ActualOutcomeRepository outcomeRepository;
    private final ActualWorkItemRepository workItemRepository;
    private final WorkspaceAuthorizationService authorizationService;

    public ActualOutcomeService(ProjectRepository projectRepository, QuotationRepository quotationRepository, QuotationItemRepository quotationItemRepository, ActualOutcomeRepository outcomeRepository, ActualWorkItemRepository workItemRepository, WorkspaceAuthorizationService authorizationService) {
        this.projectRepository = projectRepository; this.quotationRepository = quotationRepository;
        this.quotationItemRepository = quotationItemRepository; this.outcomeRepository = outcomeRepository;
        this.workItemRepository = workItemRepository; this.authorizationService = authorizationService;
    }

    @Transactional(readOnly = true)
    public ActualOutcomeResponse get(UUID userId, UUID workspaceId, UUID projectId) {
        authorize(userId, workspaceId, PermissionCode.OUTCOME_READ);
        requireProject(workspaceId, projectId);
        ActualOutcomeEntity outcome = outcomeRepository.findByWorkspaceIdAndProjectId(workspaceId, projectId)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        return response(outcome, workItemRepository.findAllByWorkspaceIdAndOutcomeIdOrderBySortOrder(workspaceId, outcome.id()));
    }

    @Transactional
    public ActualOutcomeResponse upsert(UUID userId, UUID workspaceId, UUID projectId, UpsertActualOutcomeRequest request) {
        authorize(userId, workspaceId, PermissionCode.OUTCOME_WRITE);
        projectRepository.findByIdAndWorkspaceIdForUpdate(projectId, workspaceId)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND))
            .requireNotDeleting();
        QuotationEntity quotation = validateQuotation(workspaceId, projectId, request.approvedQuotationId());
        validateWorkItems(workspaceId, quotation, request);
        Instant now = Instant.now();
        ActualOutcomeEntity outcome = outcomeRepository.findByWorkspaceIdAndProjectId(workspaceId, projectId)
            .orElseGet(() -> new ActualOutcomeEntity(UUID.randomUUID(), workspaceId, projectId, userId, now));
        BigDecimal profit = money(request.totalRevenue().subtract(request.actualCost()));
        BigDecimal margin = request.totalRevenue().signum() == 0 ? null
            : profit.divide(request.totalRevenue(), 6, RoundingMode.HALF_UP);
        outcome.update(request.approvedQuotationId(), money(request.totalRevenue()), money(request.actualCost()), money(request.actualHours()), profit, margin, request.completedOn(), trim(request.changeReason()), now);
        outcome = outcomeRepository.saveAndFlush(outcome);
        workItemRepository.deleteAllByWorkspaceIdAndOutcomeId(workspaceId, outcome.id());
        List<ActualWorkItemEntity> workItems = new ArrayList<>();
        for (int index = 0; index < request.workItems().size(); index++) {
            var item = request.workItems().get(index);
            workItems.add(new ActualWorkItemEntity(UUID.randomUUID(), workspaceId, outcome.id(), item.quotationItemId(), item.title().trim(), money(item.actualHours()), money(item.actualCost()), trim(item.notes()), index, now));
        }
        workItemRepository.saveAll(workItems);
        return response(outcome, workItems);
    }

    private QuotationEntity validateQuotation(UUID workspaceId, UUID projectId, UUID quotationId) {
        if (quotationId == null) return null;
        return quotationRepository.findByIdAndWorkspaceId(quotationId, workspaceId)
            .filter(quotation -> quotation.projectId().equals(projectId) && "PUBLISHED".equals(quotation.status()))
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "approvedQuotationId must reference a published quotation of this project"));
    }

    private void validateWorkItems(UUID workspaceId, QuotationEntity quotation, UpsertActualOutcomeRequest request) {
        for (var item : request.workItems()) {
            if (item.quotationItemId() == null) continue;
            if (quotation == null) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "quotationItemId requires approvedQuotationId");
            var quotationItem = quotationItemRepository.findByIdAndWorkspaceId(item.quotationItemId(), workspaceId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "quotationItemId is invalid"));
            if (!quotationItem.quotationId().equals(quotation.id())) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "quotationItemId must belong to approvedQuotationId");
            }
        }
    }

    private void requireProject(UUID workspaceId, UUID projectId) {
        if (projectRepository.findByIdAndWorkspaceId(projectId, workspaceId).isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
    }

    private void authorize(UUID userId, UUID workspaceId, PermissionCode permission) {
        AuthorizationDecision decision = authorizationService.authorize(userId, workspaceId, permission);
        if (decision == AuthorizationDecision.NOT_FOUND) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        if (decision == AuthorizationDecision.FORBIDDEN) throw new ResponseStatusException(HttpStatus.FORBIDDEN);
    }

    private static ActualOutcomeResponse response(ActualOutcomeEntity outcome, List<ActualWorkItemEntity> items) {
        return new ActualOutcomeResponse(
            outcome.id(), outcome.workspaceId(), outcome.projectId(), outcome.approvedQuotationId(), outcome.totalRevenue(),
            outcome.actualCost(), outcome.actualHours(), outcome.profitAmount(), outcome.profitMargin(), outcome.completedOn(),
            outcome.changeReason(), items.stream().map(item -> new ActualWorkItemResponse(item.quotationItemId(), item.title(), item.actualHours(), item.actualCost(), item.notes())).toList(), outcome.version()
        );
    }

    private static BigDecimal money(BigDecimal value) { return value.setScale(2, RoundingMode.HALF_UP); }
    private static String trim(String value) { return value == null || value.isBlank() ? null : value.trim(); }
}
