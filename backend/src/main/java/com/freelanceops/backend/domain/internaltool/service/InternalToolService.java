package com.freelanceops.backend.domain.internaltool.service;

import com.freelanceops.backend.domain.internaltool.dto.request.QuoteCalculationRequest;
import com.freelanceops.backend.domain.internaltool.dto.request.RequirementDraft;
import com.freelanceops.backend.domain.internaltool.dto.response.DomainPack;
import com.freelanceops.backend.domain.internaltool.dto.response.ProjectContext;
import com.freelanceops.backend.domain.internaltool.dto.response.QuoteCalculationResult;
import com.freelanceops.backend.domain.internaltool.dto.response.RequirementValidationResult;
import com.freelanceops.backend.domain.internaltool.entity.DomainPackEntity;
import com.freelanceops.backend.domain.internaltool.repository.DomainPackRepository;
import com.freelanceops.backend.domain.internaltool.security.DelegationPrincipal;
import com.freelanceops.backend.domain.project.entity.ProjectEntity;
import com.freelanceops.backend.domain.project.repository.ProjectRepository;
import com.freelanceops.backend.domain.quotation.service.QuotationCalculator;
import com.freelanceops.backend.domain.workspace.service.WorkspaceAuthorizationService;
import com.freelanceops.backend.domain.workspace.policy.AuthorizationDecision;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.time.LocalDate;
import java.util.UUID;

@Service
public class InternalToolService {

    private static final String FORMULA_VERSION = "quote-v1.0.0";
    private final ProjectRepository projectRepository;
    private final WorkspaceAuthorizationService authorizationService;
    private final QuotationCalculator quotationCalculator;
    private final DomainPackRepository domainPackRepository;

    public InternalToolService(ProjectRepository projectRepository, WorkspaceAuthorizationService authorizationService, QuotationCalculator quotationCalculator, DomainPackRepository domainPackRepository) {
        this.projectRepository = projectRepository;
        this.authorizationService = authorizationService;
        this.quotationCalculator = quotationCalculator;
        this.domainPackRepository = domainPackRepository;
    }

    @Transactional(readOnly = true)
    public ProjectContext getProjectContext(UUID projectId, DelegationPrincipal principal) {
        requireProjectBinding(projectId, principal);
        ProjectEntity project = projectRepository.findByIdAndWorkspaceId(projectId, principal.workspaceId())
            .orElseThrow(() -> new ToolAccessException(HttpStatus.NOT_FOUND, "PROJECT_NOT_FOUND"));
        requirePermission(principal, PermissionCode.PROJECT_READ, project.workspaceId());
        return new ProjectContext(
            project.id(), project.workspaceId(), project.title(), project.requirementText(), project.currency(),
            project.deadline(), project.budgetMin(), project.budgetMax()
        );
    }

    @Transactional(readOnly = true)
    public DomainPack getDomainPack(String domainCode, DelegationPrincipal principal) {
        requirePermission(principal, PermissionCode.WORKSPACE_READ, principal.workspaceId());
        DomainPackEntity pack = domainPackRepository
            .findFirstByCodeIgnoreCaseAndJurisdictionCodeAndActiveTrueAndEffectiveFromLessThanEqualOrderByEffectiveFromDesc(
                domainCode,
                "KR",
                LocalDate.now()
            )
            .filter(candidate -> candidate.effectiveUntil() == null || !candidate.effectiveUntil().isBefore(LocalDate.now()))
            .orElseThrow(() -> new ToolAccessException(HttpStatus.NOT_FOUND, "DOMAIN_PACK_NOT_FOUND"));
        return new DomainPack(
            pack.code(),
            pack.version(),
            pack.jurisdictionCode(),
            pack.professionCode(),
            pack.scope(),
            pack.requiredFields(),
            pack.questionTemplates(),
            pack.sourceReferences().stream()
                .map(source -> new DomainPack.SourceReference(source.get("title"), source.get("url")))
                .toList(),
            pack.effectiveFrom(),
            pack.effectiveUntil()
        );
    }

    @Transactional(readOnly = true)
    public RequirementValidationResult validateRequirements(RequirementDraft draft, DelegationPrincipal principal) {
        requireProjectBinding(draft.projectId(), principal);
        ProjectEntity project = projectRepository.findByIdAndWorkspaceId(draft.projectId(), principal.workspaceId())
            .orElseThrow(() -> new ToolAccessException(HttpStatus.NOT_FOUND, "PROJECT_NOT_FOUND"));
        requirePermission(principal, PermissionCode.PROJECT_READ, project.workspaceId());
        List<String> errors = new ArrayList<>();
        List<String> warnings = new ArrayList<>();
        if (draft.features().isEmpty()) {
            errors.add("FEATURE_REQUIRED");
        }
        if (!draft.openQuestions().isEmpty()) {
            warnings.add("OPEN_QUESTIONS_REMAIN");
        }
        if (draft.assumptions().isEmpty()) {
            warnings.add("ASSUMPTIONS_NOT_DECLARED");
        }
        return new RequirementValidationResult(errors.isEmpty(), List.copyOf(errors), List.copyOf(warnings));
    }

    @Transactional(readOnly = true)
    public QuoteCalculationResult calculateQuote(QuoteCalculationRequest request, DelegationPrincipal principal) {
        requirePermission(principal, PermissionCode.QUOTATION_WRITE, principal.workspaceId());
        QuotationCalculator.Calculation calculation = quotationCalculator.calculate(
            request.items().stream()
                .map(item -> new QuotationCalculator.ItemInput(item.quantity(), item.unitPrice(), BigDecimal.ZERO, request.discountRate()))
                .toList(),
            BigDecimal.ZERO,
            request.taxRate()
        );
        return new QuoteCalculationResult(
            request.currency(), calculation.subtotal(), calculation.discountTotal(),
            calculation.taxAmount(), calculation.total(), FORMULA_VERSION
        );
    }

    private void requirePermission(DelegationPrincipal principal, PermissionCode permission, UUID resourceWorkspaceId) {
        // Token scope와 현재 DB 권한을 모두 검사해 실행 중 권한 회수를 즉시 반영합니다.
        if (!principal.permissions().contains("agent.run") || !principal.permissions().contains(permission.code())) {
            throw new ToolAccessException(HttpStatus.FORBIDDEN, "TOOL_PERMISSION_REQUIRED");
        }
        AuthorizationDecision decision = authorizationService.authorize(
            principal.initiatedBy(), principal.workspaceId(), permission, resourceWorkspaceId
        );
        if (decision == AuthorizationDecision.NOT_FOUND) {
            throw new ToolAccessException(HttpStatus.NOT_FOUND, "RESOURCE_NOT_FOUND");
        }
        if (decision == AuthorizationDecision.FORBIDDEN) {
            throw new ToolAccessException(HttpStatus.FORBIDDEN, "TOOL_PERMISSION_REQUIRED");
        }
    }

    private static void requireProjectBinding(UUID projectId, DelegationPrincipal principal) {
        if (!principal.projectId().equals(projectId)) {
            throw new ToolAccessException(HttpStatus.NOT_FOUND, "PROJECT_NOT_FOUND");
        }
    }
}


