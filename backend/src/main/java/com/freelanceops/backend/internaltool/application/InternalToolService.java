package com.freelanceops.backend.internaltool.application;

import com.freelanceops.backend.internaltool.api.ToolContracts;
import com.freelanceops.backend.internaltool.security.DelegationPrincipal;
import com.freelanceops.backend.project.infrastructure.persistence.ProjectEntity;
import com.freelanceops.backend.project.infrastructure.persistence.ProjectRepository;
import com.freelanceops.backend.workspace.application.WorkspaceAuthorizationService;
import com.freelanceops.backend.workspace.domain.AuthorizationDecision;
import com.freelanceops.backend.workspace.domain.PermissionCode;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

@Service
public class InternalToolService {

    private static final String FORMULA_VERSION = "quote-v1.0.0";
    private static final Map<String, ToolContracts.DomainPack> DOMAIN_PACKS = Map.of(
        "software-development",
        new ToolContracts.DomainPack(
            "software-development",
            "2026-08-13",
            "소프트웨어 개발 프리랜서 견적을 위한 요구사항 점검",
            List.of("목표", "핵심 기능", "사용자", "납기", "예산", "비기능 요구사항"),
            List.of("누가 이 기능을 사용하나요?", "필수 납기와 예산 범위는 무엇인가요?", "성능·보안·운영 제약은 무엇인가요?")
        )
    );

    private final ProjectRepository projectRepository;
    private final WorkspaceAuthorizationService authorizationService;

    public InternalToolService(ProjectRepository projectRepository, WorkspaceAuthorizationService authorizationService) {
        this.projectRepository = projectRepository;
        this.authorizationService = authorizationService;
    }

    @Transactional(readOnly = true)
    public ToolContracts.ProjectContext getProjectContext(UUID projectId, DelegationPrincipal principal) {
        requireProjectBinding(projectId, principal);
        ProjectEntity project = projectRepository.findByIdAndWorkspaceId(projectId, principal.workspaceId())
            .orElseThrow(() -> new ToolAccessException(HttpStatus.NOT_FOUND, "PROJECT_NOT_FOUND"));
        requirePermission(principal, PermissionCode.PROJECT_READ, project.workspaceId());
        return new ToolContracts.ProjectContext(
            project.id(), project.workspaceId(), project.title(), project.requirementText(), project.currency(),
            project.deadline(), project.budgetMin(), project.budgetMax()
        );
    }

    @Transactional(readOnly = true)
    public ToolContracts.DomainPack getDomainPack(String domainCode, DelegationPrincipal principal) {
        requirePermission(principal, PermissionCode.WORKSPACE_READ, principal.workspaceId());
        ToolContracts.DomainPack pack = DOMAIN_PACKS.get(domainCode.toLowerCase(Locale.ROOT));
        if (pack == null) {
            throw new ToolAccessException(HttpStatus.NOT_FOUND, "DOMAIN_PACK_NOT_FOUND");
        }
        return pack;
    }

    @Transactional(readOnly = true)
    public ToolContracts.RequirementValidationResult validateRequirements(ToolContracts.RequirementDraft draft, DelegationPrincipal principal) {
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
        return new ToolContracts.RequirementValidationResult(errors.isEmpty(), List.copyOf(errors), List.copyOf(warnings));
    }

    @Transactional(readOnly = true)
    public ToolContracts.QuoteCalculationResult calculateQuote(ToolContracts.QuoteCalculationRequest request, DelegationPrincipal principal) {
        requirePermission(principal, PermissionCode.QUOTATION_WRITE, principal.workspaceId());
        BigDecimal subtotal = request.items().stream()
            .map(item -> item.quantity().multiply(item.unitPrice()))
            .reduce(BigDecimal.ZERO, BigDecimal::add)
            .setScale(2, RoundingMode.HALF_UP);
        BigDecimal discount = subtotal.multiply(request.discountRate()).setScale(2, RoundingMode.HALF_UP);
        BigDecimal taxable = subtotal.subtract(discount);
        BigDecimal tax = taxable.multiply(request.taxRate()).setScale(2, RoundingMode.HALF_UP);
        BigDecimal total = taxable.add(tax).setScale(2, RoundingMode.HALF_UP);
        return new ToolContracts.QuoteCalculationResult(request.currency(), subtotal, discount, tax, total, FORMULA_VERSION);
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
