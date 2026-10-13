package com.freelanceops.backend.domain.analysisdecision.service;

import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView;
import com.freelanceops.backend.domain.agentrun.entity.AgentRunEntity;
import com.freelanceops.backend.domain.agentrun.model.AgentRunStatus;
import com.freelanceops.backend.domain.agentrun.repository.AgentRunRepository;
import com.freelanceops.backend.domain.agentrun.service.AgentRunGatewayService;
import com.freelanceops.backend.domain.analysisdecision.dto.request.ConfirmAnalysisDecisionRequest;
import com.freelanceops.backend.domain.analysisdecision.dto.request.CreateAnalysisDecisionRequest;
import com.freelanceops.backend.domain.analysisdecision.dto.request.ReviseAnalysisDecisionRequest;
import com.freelanceops.backend.domain.analysisdecision.dto.response.AnalysisDecisionResponse;
import com.freelanceops.backend.domain.analysisdecision.dto.response.AnalysisDecisionResponse.OpinionSnapshot;
import com.freelanceops.backend.domain.analysisdecision.dto.response.AnalysisSourceResponse;
import com.freelanceops.backend.domain.analysisdecision.entity.AnalysisDecisionEntity;
import com.freelanceops.backend.domain.analysisdecision.repository.AnalysisDecisionRepository;
import com.freelanceops.backend.domain.project.entity.ProjectEntity;
import com.freelanceops.backend.domain.project.repository.ProjectRepository;
import com.freelanceops.backend.domain.workspace.policy.AuthorizationDecision;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import com.freelanceops.backend.domain.workspace.service.WorkspaceAuthorizationService;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class AnalysisDecisionService {
    private static final List<String> SCENARIOS = List.of("LEAN", "RECOMMENDED", "EXPANDED");
    private final AnalysisDecisionRepository decisions;
    private final ProjectRepository projects;
    private final AgentRunRepository runs;
    private final AgentRunGatewayService gateway;
    private final WorkspaceAuthorizationService authorization;

    public AnalysisDecisionService(AnalysisDecisionRepository decisions, ProjectRepository projects,
        AgentRunRepository runs, AgentRunGatewayService gateway, WorkspaceAuthorizationService authorization) {
        this.decisions = decisions; this.projects = projects; this.runs = runs;
        this.gateway = gateway; this.authorization = authorization;
    }

    @Transactional(readOnly = true)
    public List<AnalysisDecisionResponse> list(UUID userId, UUID workspaceId, UUID projectId) {
        authorize(userId, workspaceId, PermissionCode.PROJECT_READ);
        project(workspaceId, projectId, false);
        return decisions.findByWorkspaceIdAndProjectIdOrderByCreatedAtDescIdDesc(workspaceId, projectId,
            PageRequest.of(0, 50)).stream().map(AnalysisDecisionEntity::response).toList();
    }

    @Transactional(readOnly = true)
    public AnalysisDecisionResponse get(UUID userId, UUID workspaceId, UUID projectId, UUID decisionId) {
        authorize(userId, workspaceId, PermissionCode.PROJECT_READ);
        project(workspaceId, projectId, false);
        return decision(workspaceId, projectId, decisionId).response();
    }

    @Transactional(readOnly = true)
    public AnalysisDecisionResponse getConfirmed(UUID userId, UUID workspaceId, UUID projectId, UUID decisionId) {
        AnalysisDecisionResponse result = get(userId, workspaceId, projectId, decisionId);
        if (!"CONFIRMED".equals(result.status())) throw conflict("확정된 의견 정리만 명세의 출처로 사용할 수 있습니다.");
        return result;
    }

    @Transactional(readOnly = true)
    public Optional<AnalysisDecisionResponse> getLatestConfirmed(UUID userId, UUID workspaceId, UUID projectId) {
        authorize(userId, workspaceId, PermissionCode.PROJECT_READ);
        project(workspaceId, projectId, false);
        return decisions.findTopByWorkspaceIdAndProjectIdAndStatusOrderByConfirmedAtDescIdDesc(
            workspaceId, projectId, "CONFIRMED").map(AnalysisDecisionEntity::response);
    }

    public Optional<AnalysisSourceResponse> latestSource(UUID userId, UUID workspaceId, UUID projectId) {
        authorize(userId, workspaceId, PermissionCode.PROJECT_READ);
        authorize(userId, workspaceId, PermissionCode.AGENT_RUN);
        project(workspaceId, projectId, false);
        return runs.findFirstByWorkspaceIdAndProjectIdAndWorkflowModeOrderByCreatedAtDesc(workspaceId,
            projectId, "PROJECT_ANALYSIS").map(run -> new AnalysisSourceResponse(run.id(),
                run.sourceProjectVersion(), gateway.get(userId, workspaceId, run.id(), traceparent())));
    }

    @Transactional
    public AnalysisDecisionResponse create(UUID userId, UUID workspaceId, UUID projectId, CreateAnalysisDecisionRequest request) {
        authorize(userId, workspaceId, PermissionCode.PROJECT_WRITE);
        authorize(userId, workspaceId, PermissionCode.AGENT_RUN);
        ProjectEntity project = project(workspaceId, projectId, true);
        requireRequest(request != null && request.requestId() != null && request.sourceRunId() != null,
            "요청 식별자와 분석 출처가 필요합니다.");
        List<String> selected = request.selectedOpinionIds();
        requireRequest(selected != null && !selected.isEmpty() && selected.size() <= 3
            && new HashSet<>(selected).size() == selected.size() && selected.stream().allMatch(id -> id != null && id.length() <= 80),
            "1~3개의 서로 다른 의견을 선택해 주세요.");
        String operationHash = OpinionComposition.hash("CREATE\n" + request.sourceRunId() + "\n"
            + request.expectedProjectVersion() + "\n" + String.join("\n", selected));
        Optional<AnalysisDecisionResponse> previous = replay(userId, workspaceId, projectId, request.requestId(), operationHash);
        if (previous.isPresent()) return previous.get();
        AgentRunEntity run = runs.findByIdAndWorkspaceId(request.sourceRunId(), workspaceId)
            .filter(value -> value.projectId().equals(projectId)).orElseThrow(AnalysisDecisionService::notFound);
        if (!"PROJECT_ANALYSIS".equals(run.workflowMode()) || run.sourceProjectVersion() == null) {
            throw conflict("이전 기록은 프로젝트 원본 버전이 연결되어 있지 않습니다. 프로젝트 전체 분석을 새로 실행해 주세요.");
        }
        requireCurrentProject(project, run.sourceProjectVersion());
        if (request.expectedProjectVersion() != project.version()) throw conflict("프로젝트가 변경되었습니다. 최신 원문과 분석 출처를 다시 확인해 주세요.");
        AgentRunView view = gateway.get(userId, workspaceId, run.id(), traceparent());
        if (view.status() != AgentRunStatus.COMPLETED || view.result() == null) {
            throw conflict("완료된 프로젝트 전체 분석만 의견 정리의 출처로 사용할 수 있습니다. 부분·실패·취소 결과는 확정되지 않습니다.");
        }
        var drafts = view.result().quotationDrafts();
        requireSource(drafts.size() == 3 && drafts.stream().map(AgentRunView.QuotationDraft::scenario).distinct().count() == 3
            && drafts.stream().allMatch(draft -> draft.scenario() != null && SCENARIOS.contains(draft.scenario())), "완료된 3개 계획 관점이 필요합니다.");
        List<OpinionSnapshot> opinions = new ArrayList<>();
        for (String scenario : SCENARIOS) {
            String id = run.id() + ":" + scenario;
            if (!selected.contains(id)) continue;
            var draft = drafts.stream().filter(value -> scenario.equals(value.scenario())).findFirst().orElseThrow();
            requireValidOpinion(draft);
            opinions.add(new OpinionSnapshot(id, scenario, draft));
        }
        requireRequest(opinions.size() == selected.size(), "선택 의견이 이 분석에 속하지 않습니다.");
        List<String> warnings = OpinionComposition.warnings(opinions);
        String body;
        try { body = OpinionComposition.compose(opinions, view.result().openQuestions(), warnings); }
        catch (IllegalArgumentException error) { throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_CONTENT, error.getMessage()); }
        var metadata = view.metadata();
        var petProfiles = metadata == null || metadata.petProfiles() == null ? List.<com.freelanceops.backend.domain.agentrun.dto.PetProfile>of() : metadata.petProfiles();
        AnalysisDecisionEntity entity = new AnalysisDecisionEntity(UUID.randomUUID(), workspaceId, projectId,
            run.id(), run.sourceProjectVersion(), opinions, petProfiles, view.result().projectSummary(),
            view.result().openQuestions(), warnings, body, OpinionComposition.hash(body), request.requestId(),
            operationHash, userId, Instant.now());
        return decisions.saveAndFlush(entity).response();
    }

    @Transactional
    public AnalysisDecisionResponse revise(UUID userId, UUID workspaceId, UUID projectId, UUID decisionId, ReviseAnalysisDecisionRequest request) {
        authorize(userId, workspaceId, PermissionCode.PROJECT_WRITE);
        ProjectEntity project = project(workspaceId, projectId, true);
        requireRequest(request != null && request.requestId() != null && request.bodyText() != null
            && !request.bodyText().isBlank() && request.bodyText().length() <= OpinionComposition.MAX_BODY_LENGTH,
            "비어 있지 않은 100,000자 이하의 정리 내용을 입력해 주세요.");
        String body = request.bodyText().strip();
        String operationHash = OpinionComposition.hash("REVISE\n" + decisionId + "\n" + request.expectedContentHash() + "\n" + body);
        Optional<AnalysisDecisionResponse> previous = replay(userId, workspaceId, projectId, request.requestId(), operationHash);
        if (previous.isPresent()) return previous.get();
        AnalysisDecisionEntity base = decision(workspaceId, projectId, decisionId);
        requireLatest(workspaceId, projectId, base);
        requireHash(base, request.expectedContentHash());
        requireCurrentProject(project, base.sourceProjectVersion());
        return decisions.saveAndFlush(base.revised(UUID.randomUUID(), body, OpinionComposition.hash(body),
            request.requestId(), operationHash, userId, Instant.now())).response();
    }

    @Transactional
    public AnalysisDecisionResponse confirm(UUID userId, UUID workspaceId, UUID projectId, UUID decisionId, ConfirmAnalysisDecisionRequest request) {
        authorize(userId, workspaceId, PermissionCode.PROJECT_WRITE);
        ProjectEntity project = project(workspaceId, projectId, true);
        requireRequest(request != null && "CONFIRM_ANALYSIS_DECISION".equals(request.confirmation()), "명시적인 결과 확정이 필요합니다.");
        AnalysisDecisionEntity entity = decision(workspaceId, projectId, decisionId);
        requireHash(entity, request.expectedContentHash());
        if ("CONFIRMED".equals(entity.status())) return entity.response();
        requireLatest(workspaceId, projectId, entity);
        requireCurrentProject(project, entity.sourceProjectVersion());
        entity.confirm(userId, Instant.now());
        return decisions.saveAndFlush(entity).response();
    }

    private Optional<AnalysisDecisionResponse> replay(UUID userId, UUID workspaceId, UUID projectId, UUID requestId, String operationHash) {
        return decisions.findByWorkspaceIdAndProjectIdAndCreatedByAndRequestId(workspaceId, projectId, userId, requestId)
            .map(entity -> {
                if (!entity.operationHash().equals(operationHash)) throw conflict("같은 요청 식별자를 다른 변경에 사용할 수 없습니다.");
                return entity.response();
            });
    }

    private void requireLatest(UUID workspaceId, UUID projectId, AnalysisDecisionEntity entity) {
        var latest = decisions.findTopByWorkspaceIdAndProjectIdAndFamilyIdOrderByVersionNumberDesc(workspaceId,
            projectId, entity.familyId()).orElseThrow(AnalysisDecisionService::notFound);
        if (!latest.id().equals(entity.id())) throw conflict("새 정리 버전이 이미 저장되었습니다. 최신 버전을 확인해 주세요.");
    }

    private static void requireHash(AnalysisDecisionEntity entity, String expected) {
        if (!entity.contentHash().equals(expected)) throw conflict("검토한 내용과 저장된 내용이 다릅니다. 다시 확인해 주세요.");
    }

    private static void requireCurrentProject(ProjectEntity project, long sourceVersion) {
        if (project.version() != sourceVersion) throw conflict("분석 이후 프로젝트가 변경되었습니다. 최신 원문으로 전체 분석을 다시 실행해 주세요.");
    }

    private AnalysisDecisionEntity decision(UUID workspaceId, UUID projectId, UUID decisionId) {
        return decisions.findByIdAndWorkspaceIdAndProjectId(decisionId, workspaceId, projectId)
            .orElseThrow(AnalysisDecisionService::notFound);
    }

    private ProjectEntity project(UUID workspaceId, UUID projectId, boolean lock) {
        ProjectEntity project = (lock ? projects.findByIdAndWorkspaceIdForUpdate(projectId, workspaceId)
            : projects.findByIdAndWorkspaceId(projectId, workspaceId)).orElseThrow(AnalysisDecisionService::notFound);
        if (lock) project.requireNotDeleting();
        return project;
    }

    private void authorize(UUID userId, UUID workspaceId, PermissionCode permission) {
        var result = authorization.authorize(userId, workspaceId, permission);
        if (result == AuthorizationDecision.NOT_FOUND) throw notFound();
        if (result != AuthorizationDecision.ALLOWED) throw new ResponseStatusException(HttpStatus.FORBIDDEN);
    }

    private static void requireValidOpinion(AgentRunView.QuotationDraft draft) {
        var perspective = draft.petPerspective();
        requireSource(perspective != null && text(perspective.proposal()) && text(perspective.rationale())
            && text(perspective.tradeoff()) && draft.items() != null && !draft.items().isEmpty()
            && draft.items().size() <= 50 && draft.items().stream().allMatch(item -> item != null
                && text(item.title()) && Double.isFinite(item.quantity()) && item.quantity() > 0
                && item.unit() != null && List.of("HOUR", "DAY", "FIXED").contains(item.unit()) && item.basis() != null
                && item.basis().type() != null && List.of("EVIDENCE", "ASSUMPTION").contains(item.basis().type()) && text(item.basis().content())),
            "선택 의견의 제안·트레이드오프·작업 근거가 완전하지 않습니다. 다시 분석해 주세요.");
    }

    private static boolean text(String value) { return value != null && !value.isBlank(); }
    private static void requireSource(boolean valid, String message) { if (!valid) throw conflict(message); }
    private static void requireRequest(boolean valid, String message) { if (!valid) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, message); }
    private static ResponseStatusException notFound() { return new ResponseStatusException(HttpStatus.NOT_FOUND); }
    private static ResponseStatusException conflict(String message) { return new ResponseStatusException(HttpStatus.CONFLICT, message); }
    private static String traceparent() { return "00-" + UUID.randomUUID().toString().replace("-", "") + "-" + UUID.randomUUID().toString().replace("-", "").substring(0, 16) + "-01"; }
}
