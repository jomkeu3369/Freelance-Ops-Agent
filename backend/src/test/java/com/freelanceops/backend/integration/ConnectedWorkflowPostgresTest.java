package com.freelanceops.backend.integration;

import com.freelanceops.backend.domain.agentrun.client.*;
import com.freelanceops.backend.domain.agentrun.client.dto.request.InternalAgentRunRequest;
import com.freelanceops.backend.domain.agentrun.dto.PetProfile;
import com.freelanceops.backend.domain.agentrun.dto.request.ResumeAgentRunRequest;
import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest;
import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView;
import com.freelanceops.backend.domain.agentrun.dto.response.StartAgentRunResponse;
import com.freelanceops.backend.domain.agentrun.model.*;
import com.freelanceops.backend.domain.agentrun.repository.AgentRunRepository;
import com.freelanceops.backend.domain.agentrun.security.DelegationTokenIssuer;
import com.freelanceops.backend.domain.agentrun.service.*;
import com.freelanceops.backend.domain.analysisdecision.dto.request.*;
import com.freelanceops.backend.domain.analysisdecision.dto.response.AnalysisDecisionResponse;
import com.freelanceops.backend.domain.client.dto.request.CreateClientRequest;
import com.freelanceops.backend.domain.client.dto.response.ClientResponse;
import com.freelanceops.backend.domain.identity.dto.request.*;
import com.freelanceops.backend.domain.identity.dto.response.AuthTokenResponse;
import com.freelanceops.backend.domain.internaltool.security.DelegationTokenVerifier;
import com.freelanceops.backend.domain.knowledge.client.RaptorBuildClient;
import com.freelanceops.backend.domain.knowledge.dto.request.*;
import com.freelanceops.backend.domain.knowledge.dto.response.DocumentResponse;
import com.freelanceops.backend.domain.knowledge.dto.response.KnowledgeSearchResult;
import com.freelanceops.backend.domain.project.dto.request.CreateProjectRequest;
import com.freelanceops.backend.domain.project.dto.response.ProjectResponse;
import com.freelanceops.backend.domain.project.repository.ProjectRepository;
import com.freelanceops.backend.domain.quotation.client.QuotationAssumptionClient;
import com.freelanceops.backend.domain.specification.dto.request.*;
import com.freelanceops.backend.domain.specification.dto.response.SpecificationResponse;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.text.PDFTextStripper;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.dao.DataAccessException;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;
import tools.jackson.databind.ObjectMapper;

import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.*;
import static org.junit.jupiter.api.Assertions.assertAll;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Connected acceptance boundary: actual Spring security/controller/JPA, PostgreSQL/Flyway,
 * admission/outbox/dispatcher/projection, immutable analysis/specification, PDFBox and SQL search.
 * Only outbound clients are mocked. All identities, requirements, answers and Agent work products
 * are synthetic; this does not prove model execution, actual remote Agent HTTP or production readiness.
 * The CI report gate discovers @Testcontainers and rejects missing, skipped or failed executions.
 */
@Testcontainers(disabledWithoutDocker = true)
@SpringBootTest(properties = {"app.environment=test", "spring.flyway.create-schemas=true",
    "agent.command-dispatch-enabled=false", "agent.task-command-dispatch-enabled=false",
    "agent.reconciliation-enabled=false", "agent.route-observation-collection-enabled=false",
    "app.notices.dispatch-enabled=false", "app.auth.email-verification.required=false",
    "app.rate-limit.enabled=false", "platform.ai.spend.enabled=false",
    "APP_BYOK_ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="})
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
@Timeout(90)
class ConnectedWorkflowPostgresTest {
    @Container static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer(
        DockerImageName.parse("pgvector/pgvector:pg17").asCompatibleSubstituteFor("postgres"));
    // Ephemeral test-only signing material. Nothing is persisted or sent to a provider.
    private static final KeyPair TEST_KEYS = testKeys();
    @DynamicPropertySource static void datasource(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("agent.delegation.private-key", () -> Base64.getEncoder().encodeToString(TEST_KEYS.getPrivate().getEncoded()));
        registry.add("agent.delegation.public-key", () -> Base64.getEncoder().encodeToString(TEST_KEYS.getPublic().getEncoded()));
    }

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper mapper;
    @Autowired AgentRunCommandQueue queue;
    @Autowired AgentRunRepository runs;
    @Autowired ProjectRepository projects;
    @Autowired AgentRunProjectionService projection;
    @Autowired DelegationTokenIssuer tokens;
    @Autowired DelegationTokenVerifier tokenVerifier;
    @Autowired ByokExecutionService byok;
    @MockitoBean AgentRunClient agent;
    @MockitoBean RaptorBuildClient paidIndex;
    @MockitoBean ProviderCredentialVerifier providerVerifier;
    @MockitoBean PetGenerationClient paidPet;
    @MockitoBean AttachmentReaderClient attachmentReader;
    @MockitoBean QuotationAssumptionClient paidAssumptions;

    private static final String PASSWORD = "Synthetic-test-password-23!";
    private static final String INPUT = "합성 고객 원문 INTAKE_ONLY: 일정표와 관리자 화면을 요청합니다.";
    private static final String ANSWER = "합성 고객 답변 CLARIFICATION_ONLY: 자료는 고객이 제공합니다.";
    private static final String QUERY = "connected_keyword";
    private static final String FINAL_BODY = "  사용자 최종 확인 connected_keyword\n"
        + "명세 범위는 일정표와 관리자 화면입니다. <script>literal</script>\n"
        + "자료는 고객 제공. 가격과 미확인 질문은 별도 검토합니다.\n마지막 확정 기준  ";
    private AuthTokenResponse owner;
    private ClientResponse client;
    private ProjectResponse project;
    private UUID credential;
    private AgentRunCommandDispatcher dispatcher;
    private final Map<UUID, AgentRunView> views = new HashMap<>();
    private final Map<UUID, InternalAgentRunRequest> starts = new HashMap<>();
    private int reads, resumes;

    @BeforeEach void setup() throws Exception {
        views.clear(); starts.clear(); reads = 0; resumes = 0;
        owner = registerAndLogin("owner");
        client = postJson(owner, workspace(owner) + "/clients", new CreateClientRequest(
            "합성 고객", "Synthetic Fixture", UUID.randomUUID() + "@example.invalid", null, "Synthetic data only"), 201, ClientResponse.class);
        project = createProject(owner, client.id(), "합성 프로젝트");
        assertThat(project.workspaceId()).isEqualTo(owner.workspaceId());
        assertThat(project.clientId()).isEqualTo(client.id());
        assertThat(project.version()).isZero();
        assertThat(jdbc.queryForObject("select content from app.source_message where project_id=? and kind='PROJECT_INPUT'",
            String.class, project.id())).isEqualTo(INPUT);
        credential = UUID.randomUUID();
        // Simulates a previously reviewed connection; intentionally invalid ciphertext is never decrypted.
        jdbc.update("insert into app.ai_connection(id,workspace_id,user_id,provider,model,ciphertext,masked_key) values (?,?,?,'OPENAI','gpt-6-luna','synthetic-never-decrypted','test')",
            credential, owner.workspaceId(), owner.userId());
        dispatcher = new AgentRunCommandDispatcher(queue, runs, projects, agent, tokens, projection, mapper, byok);
        when(agent.start(any(), anyString(), any())).thenAnswer(invocation -> {
            InternalAgentRunRequest input = invocation.getArgument(0);
            var context = input.context();
            var principal = tokenVerifier.verify(invocation.getArgument(1));
            assertThat(principal.runId()).isEqualTo(context.runId());
            assertThat(principal.workspaceId()).isEqualTo(owner.workspaceId());
            assertThat(principal.projectId()).isEqualTo(context.projectId());
            assertThat(principal.initiatedBy()).isEqualTo(owner.userId());
            assertThat(principal.permissions()).contains("agent.run", "project.read", "document.read");
            assertThat(input.platformBudget()).isNull();
            assertThat(input.byokBudget().credentialId()).isEqualTo(credential);
            assertThat(input.byokBudget().costNoticeVersion()).isEqualTo(ByokCostNoticePolicy.VERSION);
            starts.put(context.runId(), input);
            views.put(context.runId(), view(context.runId(), AgentRunStatus.WAITING_FOR_USER, true));
            return new StartAgentRunResponse(context.runId(), AgentRunStatus.WAITING_FOR_USER, Instant.now());
        });
        when(agent.get(any(), anyString(), any())).thenAnswer(invocation -> {
            reads++;
            UUID run = invocation.getArgument(0);
            assertThat(tokenVerifier.verify(invocation.getArgument(1)).runId()).isEqualTo(run);
            assertThat(views).containsKey(run);
            return views.get(run);
        });
        when(agent.resume(any(), any(), anyString(), any())).thenAnswer(invocation -> {
            resumes++;
            UUID run = invocation.getArgument(0);
            ResumeAgentRunRequest request = invocation.getArgument(1);
            assertThat(request.interruptionId()).isEqualTo(views.get(run).interruption().interruptionId());
            assertThat(request.answers()).containsExactly(new ResumeAgentRunRequest.ResumeAnswer(0, ANSWER));
            views.put(run, view(run, AgentRunStatus.COMPLETED, false));
            return new StartAgentRunResponse(run, AgentRunStatus.COMPLETED, Instant.now());
        });
    }

    @AfterEach void noPaidOrUnexpectedOutboundCalls() {
        verifyNoInteractions(paidIndex, providerVerifier, paidPet, attachmentReader, paidAssumptions);
        verify(agent, times(starts.size())).start(any(), anyString(), any());
        verify(agent, times(reads)).get(any(), anyString(), any());
        verify(agent, times(resumes)).resume(any(), any(), anyString(), any());
        verifyNoMoreInteractions(agent);
        assertThat(jdbc.queryForObject("select count(*) from app.byok_provider_attempt attempt join app.byok_execution_scope scope using(scope_id) where scope.payload->>'workspaceId'=?",
            Integer.class, owner.workspaceId().toString())).isZero();
        assertThat(jdbc.queryForObject("select count(*) from app.platform_spend_reservation where user_id=?", Integer.class, owner.userId())).isZero();
        assertThat(jdbc.queryForObject("select count(*) from app.document_chunk where workspace_id=? and embedding is not null", Integer.class, owner.workspaceId())).isZero();
    }

    @ParameterizedTest(name = "connected auth-to-confirmed-keyword flow with {0} selected opinions")
    @ValueSource(ints = {1, 2, 3})
    void actualHttpAndPostgresJourneyKeepsOnlyExactConfirmedFinalText(int count) throws Exception {
        UUID run = completeAnalysis();
        List<String> scenarios = count == 1 ? List.of("LEAN") : count == 2 ? List.of("LEAN", "EXPANDED") : List.of("LEAN", "RECOMMENDED", "EXPANDED");
        var reversed = new ArrayList<>(scenarios); Collections.reverse(reversed);
        var create = new CreateAnalysisDecisionRequest(UUID.randomUUID(), run, 0, reversed.stream().map(value -> run + ":" + value).toList());
        var draft = postJson(owner, decisions(), create, 200, AnalysisDecisionResponse.class);
        assertThat(draft.selectedOpinionIds()).containsExactlyElementsOf(scenarios.stream().map(value -> run + ":" + value).toList());
        assertThat(draft.sourceOpinions()).extracting(value -> value.scenario()).containsExactlyElementsOf(scenarios);
        assertThat(draft.sourcePetProfiles()).extracting(PetProfile::slot).containsExactly("LEAN", "RECOMMENDED", "EXPANDED");
        for (String scenario : List.of("LEAN", "RECOMMENDED", "EXPANDED")) {
            if (scenarios.contains(scenario)) assertThat(draft.bodyText()).contains("PROPOSAL_" + scenario, "ITEM_" + scenario);
            else assertThat(draft.bodyText()).doesNotContain("PROPOSAL_" + scenario, "ITEM_" + scenario);
        }
        assertThat(draft.sourceOpenQuestions()).containsExactly("OPEN_QUESTION_ONLY: 최종 납기 확인?");
        assertThat(draft.sourceMessages()).extracting(value -> value.kind()).contains("PROJECT_INPUT", "RUN_INPUT", "USER_CLARIFICATION");
        assertThat(draft.sourceMessages()).extracting(value -> value.content()).contains(INPUT, ANSWER);
        assertThat(postJson(owner, decisions(), create, 200, AnalysisDecisionResponse.class).id()).isEqualTo(draft.id());
        postStatus(owner, decisions(), new CreateAnalysisDecisionRequest(create.requestId(), run, 0, List.of(run + ":RECOMMENDED")), 409);
        postStatus(owner, specifications(), new CreateSpecificationRequest(draft.id(), UUID.randomUUID()), 409);
        assertThat(search(run, project.id(), QUERY)).isEmpty();

        String decisionText = "사용자가 검토한 결정 DECISION_EDIT_ONLY: 일정표와 관리자 화면만 포함합니다.";
        var revisionInput = new ReviseAnalysisDecisionRequest(UUID.randomUUID(), draft.contentHash(), decisionText);
        var edited = postJson(owner, decisions() + "/" + draft.id() + "/revisions", revisionInput, 200, AnalysisDecisionResponse.class);
        assertThat(edited.id()).isNotEqualTo(draft.id());
        assertThat(edited.previousId()).isEqualTo(draft.id());
        assertThat(edited.versionNumber()).isEqualTo(2);
        assertThat(edited.originalBodyText()).isEqualTo(draft.bodyText());
        assertThat(edited.sourceOpinions()).isEqualTo(draft.sourceOpinions());
        assertThat(postJson(owner, decisions() + "/" + draft.id() + "/revisions", revisionInput, 200, AnalysisDecisionResponse.class).id()).isEqualTo(edited.id());
        postStatus(owner, decisions() + "/" + draft.id() + "/confirm", confirmDecision(draft), 409);
        postStatus(owner, decisions() + "/" + edited.id() + "/confirm", Map.of("expectedContentHash", edited.contentHash(), "confirmation", "SAVE"), 400);
        postStatus(owner, decisions() + "/" + edited.id() + "/confirm", new ConfirmAnalysisDecisionRequest("0".repeat(64), "CONFIRM_ANALYSIS_DECISION"), 409);
        var confirmedDecision = postJson(owner, decisions() + "/" + edited.id() + "/confirm", confirmDecision(edited), 200, AnalysisDecisionResponse.class);
        assertThat(confirmedDecision.status()).isEqualTo("CONFIRMED");
        assertThat(confirmedDecision.confirmedBy()).isEqualTo(owner.userId());
        assertThat(getJson(owner, decisions() + "/latest-confirmed", AnalysisDecisionResponse.class).id()).isEqualTo(edited.id());
        assertThat(getJson(owner, decisions() + "/" + draft.id(), AnalysisDecisionResponse.class).bodyText()).isEqualTo(draft.bodyText());

        var specCreate = new CreateSpecificationRequest(confirmedDecision.id(), UUID.randomUUID());
        var specDraft = postJson(owner, specifications(), specCreate, 200, SpecificationResponse.class);
        assertThat(specDraft.sourceDecisionId()).isEqualTo(confirmedDecision.id());
        assertThat(specDraft.sourceDecisionVersion()).isEqualTo(2);
        assertThat(specDraft.sourceDecisionHash()).isEqualTo(confirmedDecision.contentHash());
        assertThat(specDraft.sourceBodyText()).isEqualTo(decisionText);
        assertThat(specDraft.sourceRunId()).isEqualTo(run);
        assertThat(specDraft.originalSources()).extracting(value -> value.content()).contains(INPUT, ANSWER);
        assertThat(specDraft.sourceProvenance().get("originalBodyText")).isEqualTo(draft.bodyText());
        assertThat(specDraft.indexStatus()).isEqualTo("NOT_INDEXED");
        assertThat(postJson(owner, specifications(), specCreate, 200, SpecificationResponse.class).id()).isEqualTo(specDraft.id());
        mvc.perform(authorized(get(specifications() + "/" + specDraft.id() + "/pdf"), owner)).andExpect(status().isConflict());
        var specRevision = new ReviseSpecificationRequest(UUID.randomUUID(), specDraft.contentHash(), "합성 명세서 / 최종", FINAL_BODY);
        var specEdited = postJson(owner, specifications() + "/" + specDraft.id() + "/revisions", specRevision, 200, SpecificationResponse.class);
        assertThat(specEdited.id()).isNotEqualTo(specDraft.id());
        assertThat(specEdited.supersedes()).isEqualTo(specDraft.id());
        assertThat(specEdited.revisionNumber()).isEqualTo(2);
        assertThat(postJson(owner, specifications() + "/" + specDraft.id() + "/revisions", specRevision, 200, SpecificationResponse.class).id()).isEqualTo(specEdited.id());
        postStatus(owner, specifications() + "/" + specDraft.id() + "/revisions", new ReviseSpecificationRequest(specRevision.requestId(), specDraft.contentHash(), specEdited.title(), "Changed payload"), 409);
        postStatus(owner, specifications() + "/" + specDraft.id() + "/confirm", confirmSpec(specDraft), 409);
        postStatus(owner, specifications() + "/" + specEdited.id() + "/confirm", Map.of("expectedContentHash", specEdited.contentHash(), "confirmation", "SAVE"), 400);
        assertThat(search(run, project.id(), QUERY)).isEmpty();
        var confirmed = postJson(owner, specifications() + "/" + specEdited.id() + "/confirm", confirmSpec(specEdited), 200, SpecificationResponse.class);
        assertThat(postJson(owner, specifications() + "/" + specEdited.id() + "/confirm", confirmSpec(specEdited), 200, SpecificationResponse.class).reusableDocumentId()).isEqualTo(confirmed.reusableDocumentId());
        assertThat(confirmed.bodyText()).isEqualTo(FINAL_BODY);
        assertThat(confirmed.contentHash()).isEqualTo(hash(FINAL_BODY));
        assertThat(confirmed.indexStatus()).isEqualTo("KEYWORD_ONLY");
        assertThat(confirmed.confirmedBy()).isEqualTo(owner.userId());
        assertThat(confirmed.sourceCurrent()).isTrue();
        assertThat(getJson(owner, specifications() + "/" + specDraft.id(), SpecificationResponse.class).bodyText()).isEqualTo(decisionText);
        assertThat(getJson(owner, specifications() + "/" + confirmed.id(), SpecificationResponse.class).bodyText()).isEqualTo(FINAL_BODY);
        assertThat(jdbc.queryForObject("select count(*) from app.document where project_id=? and source_specification_id is not null", Integer.class, project.id())).isOne();
        assertThat(jdbc.queryForObject("select source_specification_id from app.document where id=?", UUID.class, confirmed.reusableDocumentId())).isEqualTo(confirmed.id());
        assertThat(jdbc.queryForObject("select string_agg(content,'' order by chunk_index) from app.document_chunk where document_id=?", String.class, confirmed.reusableDocumentId())).isEqualTo(FINAL_BODY);
        var document = getJson(owner, workspace(owner) + "/documents/" + confirmed.reusableDocumentId(), DocumentResponse.class);
        assertThat(document.chunks()).extracting(value -> value.content()).containsExactly(FINAL_BODY);
        assertThat(document.origin()).isEqualTo("user");
        assertThat(document.memoryType()).isEqualTo("decision");
        assertThat(document.confirmationStatus()).isEqualTo("confirmed");
        assertThat(document.contentSha256()).isEqualTo(confirmed.contentHash());
        assertThat(document.sourceUri()).isEqualTo("specification:" + confirmed.id());
        assertThat(document.sourceVersion()).isEqualTo("spec-v2");
        assertThat(document.sourceMessageIds()).containsExactlyElementsOf(confirmed.originalSources().stream().map(value -> value.id()).toList());

        // Retrieve from another legitimate run in this same project. Excluding that run must
        // not accidentally hide the earlier unconfirmed AI projection by source-run identity.
        UUID lookupRun = beginAnalysis(project, "AD_HOC");
        var hits = search(lookupRun, project.id(), QUERY);
        assertThat(hits).hasSize(1);
        assertThat(hits.getFirst().documentId()).isEqualTo(confirmed.reusableDocumentId());
        assertThat(hits.getFirst().content()).isEqualTo(FINAL_BODY).doesNotContain("PROPOSAL_", "ITEM_", "AI_UNCONFIRMED", "DECISION_EDIT_ONLY", "INTAKE_ONLY", "CLARIFICATION_ONLY");
        assertThat(hits.getFirst().projectId()).isEqualTo(project.id());
        assertThat(hits.getFirst().origin()).isEqualTo("user");
        assertThat(hits.getFirst().vectorRank()).isNull();
        for (String forbidden : List.of("PROPOSAL_LEAN", "PROPOSAL_RECOMMENDED", "PROPOSAL_EXPANDED", "AI_UNCONFIRMED", "DECISION_EDIT_ONLY", "OPEN_QUESTION_ONLY"))
            assertThat(search(lookupRun, project.id(), forbidden)).isEmpty();
        var other = createProject(owner, client.id(), "같은 작업공간 다른 프로젝트");
        UUID otherRun = beginAnalysis(other, "PROJECT_ANALYSIS");
        assertThat(search(otherRun, other.id(), QUERY)).isEmpty();

        System.out.println("CONNECTED n=" + count + " exact confirmed keyword reuse and isolation PASS");
        var pdfBeforeSourceChange = new AtomicReference<byte[]>();
        // A required PDF failure must fail this test while independent durable DB boundaries
        // still execute. No missing font, status 503, unavailable baseline or fallback is a pass.
        assertAll("Connected required durable/PDF stages n=" + count,
            () -> {
                MvcResult firstPdf = mvc.perform(authorized(get(specifications() + "/" + confirmed.id() + "/pdf"), owner))
                    .andExpect(status().isOk()).andExpect(content().contentType(MediaType.APPLICATION_PDF))
                    .andExpect(header().string("X-Specification-Content-SHA256", confirmed.contentHash()))
                    .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "private, no-store")).andReturn();
                byte[] bytes = firstPdf.getResponse().getContentAsByteArray();
                pdfBeforeSourceChange.set(bytes);
                assertThat(new String(bytes, 0, 5, StandardCharsets.US_ASCII)).isEqualTo("%PDF-");
                assertThat(ContentDisposition.parse(firstPdf.getResponse().getHeader(HttpHeaders.CONTENT_DISPOSITION)).getFilename()).isEqualTo("합성 명세서 _ 최종-v2.pdf");
                try (var pdf = Loader.loadPDF(bytes)) {
                    assertThat(new PDFTextStripper().getText(pdf)).contains("사용자 최종 확인", "<script>literal</script>", "마지막 확정 기준", confirmed.contentHash())
                        .doesNotContain("PROPOSAL_", "AI_UNCONFIRMED", "DECISION_EDIT_ONLY");
                }
                assertThat(mvc.perform(authorized(get(specifications() + "/" + confirmed.id() + "/pdf"), owner)).andExpect(status().isOk()).andReturn().getResponse().getContentAsByteArray()).isEqualTo(bytes);
                System.out.println("CONNECTED n=" + count + " real PDF parse and identical repeat bytes PASS");
            },
            () -> {
                assertThatThrownBy(() -> jdbc.update("update app.analysis_decision set body_text='tampered' where id=?", confirmedDecision.id())).isInstanceOf(DataAccessException.class);
                assertThatThrownBy(() -> jdbc.update("update app.specification set body_text='tampered' where id=?", confirmed.id())).isInstanceOf(DataAccessException.class);
                assertThatThrownBy(() -> jdbc.update("delete from app.specification where id=?", confirmed.id())).isInstanceOf(DataAccessException.class);
                // A fresh ID/revision with an otherwise valid confirmed source and document must still
                // begin as a review draft. This used to bypass the UPDATE-only lossless-projection guard.
                assertThatThrownBy(() -> jdbc.update("""
                    insert into app.specification
                    select (jsonb_populate_record(null::app.specification,
                        to_jsonb(specification) || jsonb_build_object('id', ?::uuid, 'revision_number', 3))).*
                    from app.specification specification where specification.id=?
                    """, UUID.randomUUID(), confirmed.id())).isInstanceOf(DataAccessException.class)
                    .hasMessageContaining("specification must begin as a draft and use the lossless confirmation transition");
                assertThat(jdbc.queryForObject("select count(*) from app.specification where project_id=?", Integer.class, project.id())).isEqualTo(2);
                // A semantic confirmation changes truth without changing the optimistic project version.
                jdbc.update("insert into app.source_message(workspace_id,project_id,event_key,kind,content,created_by) values (?,?,?,'REQUIREMENT_CONFIRMATION','새 합성 확정 범위',?)",
                    owner.workspaceId(), project.id(), "connected-source-change:" + UUID.randomUUID(), owner.userId());
                assertThat(jdbc.queryForObject("select version from app.project where id=?", Long.class, project.id())).isZero();
                mvc.perform(authorized(get(decisions() + "/sources/latest"), owner)).andExpect(status().isOk())
                    .andExpect(jsonPath("runId").value(run.toString())).andExpect(jsonPath("sourceCurrent").value(false))
                    .andExpect(jsonPath("view.status").value("COMPLETED"));
                var obsolete = getJson(owner, specifications() + "/" + confirmed.id(), SpecificationResponse.class);
                assertThat(obsolete.sourceCurrent()).isFalse();
                assertThat(obsolete.indexStatus()).isEqualTo("SUPERSEDED");
                assertThat(search(lookupRun, project.id(), QUERY)).isEmpty();
                postStatus(owner, decisions(), new CreateAnalysisDecisionRequest(UUID.randomUUID(), run, 0, List.of(run + ":LEAN")), 409);
                System.out.println("CONNECTED n=" + count + " DB immutability, direct INSERT rejection and semantic keyword supersession PASS");
            },
            () -> {
                byte[] historicalPdf = mvc.perform(authorized(get(specifications() + "/" + confirmed.id() + "/pdf"), owner))
                    .andExpect(status().isOk()).andReturn().getResponse().getContentAsByteArray();
                assertThat(pdfBeforeSourceChange.get()).as("historical PDF comparison requires actual pre-invalidation PDF bytes").isNotNull();
                assertThat(historicalPdf).isEqualTo(pdfBeforeSourceChange.get());
                System.out.println("CONNECTED n=" + count + " immutable historical PDF bytes PASS");
            });
    }

    @ParameterizedTest(name = "{0} work product remains nonconfirmable")
    @EnumSource(value = AgentRunStatus.class, names = {"QUEUED", "RUNNING", "WAITING_FOR_USER", "PARTIAL", "FAILED", "CANCELLED"})
    void incompleteAnalysisCannotBecomeDecisionOrReusableKnowledge(AgentRunStatus status) throws Exception {
        UUID run = beginAnalysis(project, "PROJECT_ANALYSIS");
        views.put(run, view(run, status, status == AgentRunStatus.WAITING_FOR_USER));
        getJson(owner, workspace(owner) + "/agent-runs/" + run, AgentRunView.class);
        postStatus(owner, decisions(), new CreateAnalysisDecisionRequest(UUID.randomUUID(), run, 0, List.of(run + ":LEAN")), 409);
        assertThat(jdbc.queryForObject("select count(*) from app.analysis_decision where project_id=?", Integer.class, project.id())).isZero();
        assertThat(jdbc.queryForObject("select count(*) from app.specification where project_id=?", Integer.class, project.id())).isZero();
        assertThat(search(run, project.id(), QUERY)).isEmpty();
    }

    @Test void zeroMixedForeignAndAdHocOpinionSourcesAreRejectedWithoutWrites() throws Exception {
        UUID run = completeAnalysis();
        postStatus(owner, decisions(), new CreateAnalysisDecisionRequest(UUID.randomUUID(), run, 0, List.of()), 400);
        postStatus(owner, decisions(), new CreateAnalysisDecisionRequest(UUID.randomUUID(), run, 0, List.of(run + ":LEAN", UUID.randomUUID() + ":EXPANDED")), 400);
        var other = createProject(owner, client.id(), "별도 합성 프로젝트");
        UUID foreignRun = beginAnalysis(other, "PROJECT_ANALYSIS");
        postStatus(owner, decisions(), new CreateAnalysisDecisionRequest(UUID.randomUUID(), foreignRun, 0, List.of(foreignRun + ":LEAN")), 404);
        UUID adHoc = beginAnalysis(project, "AD_HOC");
        views.put(adHoc, view(adHoc, AgentRunStatus.COMPLETED, false));
        getJson(owner, workspace(owner) + "/agent-runs/" + adHoc, AgentRunView.class);
        postStatus(owner, decisions(), new CreateAnalysisDecisionRequest(UUID.randomUUID(), adHoc, 0, List.of(adHoc + ":LEAN")), 409);
        // Even COMPLETED cannot substitute an incomplete/malformed three-perspective result.
        var valid = views.get(run);
        var malformed = new AgentRunView.AgentRunResult("Synthetic malformed", List.of(), List.of(), null,
            List.of(opinion("LEAN"), opinion("EXPANDED")));
        views.put(run, new AgentRunView(run, AgentRunStatus.COMPLETED, null, null, malformed, null, valid.metadata(), null, Instant.now()));
        postStatus(owner, decisions(), new CreateAnalysisDecisionRequest(UUID.randomUUID(), run, 0, List.of(run + ":LEAN")), 409);
        var malformedUnselected = new AgentRunView.AgentRunResult("Synthetic invalid unselected", List.of(), List.of(), null,
            List.of(opinion("LEAN"), new AgentRunView.QuotationDraft("RECOMMENDED", opinion("RECOMMENDED").items(), null), opinion("EXPANDED")));
        views.put(run, new AgentRunView(run, AgentRunStatus.COMPLETED, null, null, malformedUnselected, null, valid.metadata(), null, Instant.now()));
        postStatus(owner, decisions(), new CreateAnalysisDecisionRequest(UUID.randomUUID(), run, 0, List.of(run + ":LEAN")), 409);
        assertThat(jdbc.queryForObject("select count(*) from app.analysis_decision where project_id=?", Integer.class, project.id())).isZero();
    }

    @Test void realBearerAuthMembershipAndProjectScopeProtectEveryDurableBoundary() throws Exception {
        UUID run = completeAnalysis();
        var decision = postJson(owner, decisions(), new CreateAnalysisDecisionRequest(UUID.randomUUID(), run, 0, List.of(run + ":LEAN")), 200, AnalysisDecisionResponse.class);
        decision = postJson(owner, decisions() + "/" + decision.id() + "/confirm", confirmDecision(decision), 200, AnalysisDecisionResponse.class);
        var spec = postJson(owner, specifications(), new CreateSpecificationRequest(decision.id(), UUID.randomUUID()), 200, SpecificationResponse.class);
        var confirmed = postJson(owner, specifications() + "/" + spec.id() + "/confirm", confirmSpec(spec), 200, SpecificationResponse.class);
        var outsider = registerAndLogin("outsider");
        var viewer = registerAndLogin("viewer");
        UUID member = UUID.randomUUID();
        jdbc.update("insert into app.workspace_member(id,workspace_id,user_id,status) values (?,?,?,'ACTIVE')", member, owner.workspaceId(), viewer.userId());
        UUID viewerRole = jdbc.queryForObject("select id from app.workspace_role where workspace_id=? and code='VIEWER'", UUID.class, owner.workspaceId());
        jdbc.update("insert into app.member_role(workspace_id,membership_id,role_id,assigned_by) values (?,?,?,?)", owner.workspaceId(), member, viewerRole, owner.userId());
        for (String path : List.of(decisions() + "/" + decision.id(), specifications() + "/" + confirmed.id(), specifications() + "/" + confirmed.id() + "/pdf", workspace(owner) + "/documents/" + confirmed.reusableDocumentId())) {
            mvc.perform(get(path)).andExpect(status().isUnauthorized());
            mvc.perform(get(path).header(HttpHeaders.AUTHORIZATION, "Bearer invalid-synthetic-token")).andExpect(status().isUnauthorized());
            mvc.perform(authorized(get(path), outsider)).andExpect(status().isNotFound());
            // The successful PDF read remains mandatory below, after independent RBAC checks.
            if (!path.endsWith("/pdf")) mvc.perform(authorized(get(path), viewer)).andExpect(status().isOk());
        }
        postStatus(viewer, decisions(), new CreateAnalysisDecisionRequest(UUID.randomUUID(), run, 0, List.of(run + ":LEAN")), 403);
        postStatus(viewer, decisions() + "/" + decision.id() + "/revisions", new ReviseAnalysisDecisionRequest(UUID.randomUUID(), decision.contentHash(), "Viewer edit"), 403);
        postStatus(viewer, decisions() + "/" + decision.id() + "/confirm", confirmDecision(decision), 403);
        postStatus(viewer, specifications(), new CreateSpecificationRequest(decision.id(), UUID.randomUUID()), 403);
        postStatus(viewer, specifications() + "/" + spec.id() + "/revisions", new ReviseSpecificationRequest(UUID.randomUUID(), spec.contentHash(), "Viewer title", "Viewer edit"), 403);
        postStatus(viewer, specifications() + "/" + spec.id() + "/confirm", confirmSpec(spec), 403);
        var other = createProject(owner, client.id(), "다른 프로젝트");
        String otherBase = workspace(owner) + "/projects/" + other.id();
        mvc.perform(authorized(get(otherBase + "/analysis-decisions/" + decision.id()), owner)).andExpect(status().isNotFound());
        mvc.perform(authorized(get(otherBase + "/specifications/" + confirmed.id()), owner)).andExpect(status().isNotFound());
        mvc.perform(authorized(get(workspace(outsider) + "/projects/" + project.id() + "/specifications/" + confirmed.id()), owner)).andExpect(status().isNotFound());
        // Genuine delegation signature and run-header binding, with no security mock postprocessors.
        String token = tokens.issue(run, owner.workspaceId(), project.id(), owner.userId(), List.of("agent.run", "document.read"));
        mvc.perform(post("/internal/v1/knowledge/search").header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
            .header("X-Run-Id", UUID.randomUUID().toString()).contentType(MediaType.APPLICATION_JSON)
            .content(mapper.writeValueAsString(new KnowledgeSearchRequest(QUERY, null, 10)))).andExpect(status().isUnauthorized());
        String noRead = tokens.issue(run, owner.workspaceId(), project.id(), owner.userId(), List.of("agent.run"));
        mvc.perform(post("/internal/v1/knowledge/search").header(HttpHeaders.AUTHORIZATION, "Bearer " + noRead)
            .header("X-Run-Id", run.toString()).contentType(MediaType.APPLICATION_JSON)
            .content(mapper.writeValueAsString(new KnowledgeSearchRequest(QUERY, null, 10)))).andExpect(status().isUnauthorized());
        assertThat(jdbc.queryForObject("select count(*) from app.analysis_decision where project_id=?", Integer.class, project.id())).isOne();
        assertThat(jdbc.queryForObject("select count(*) from app.specification where project_id=?", Integer.class, project.id())).isOne();
        System.out.println("CONNECTED real bearer, membership, write-denial and delegated-claim boundaries PASS");
        mvc.perform(authorized(get(specifications() + "/" + confirmed.id() + "/pdf"), viewer)).andExpect(status().isOk());
    }

    @Test void admissionOffAndUnsupportedPaidRaptorDoNotCreateExecutionOrIndex() throws Exception {
        var personal = startRequest(project, "PROJECT_ANALYSIS");
        var platform = new StartAgentRunRequest(personal.requirementText(), personal.locale(), null,
            new StartAgentRunRequest.ModelSelection(Provider.OPENAI, "gpt-6-luna", ReasoningEffort.LOW),
            personal.budget(), personal.safetyContext(), null, List.of(), null, "PROJECT_ANALYSIS", null);
        postStatus(owner, projectBase() + "/agent-runs", platform, 503);
        postStatus(owner, projectBase() + "/knowledge/raptor-indexes",
            new CreateRaptorIndexRequest(Provider.OPENAI, "text-embedding-3-small", "gpt-6-luna", 4, 2, 10), 503);
        assertThat(jdbc.queryForObject("select count(*) from app.agent_run where workspace_id=?", Integer.class, owner.workspaceId())).isZero();
        assertThat(jdbc.queryForObject("select count(*) from app.raptor_index_snapshot where workspace_id=?", Integer.class, owner.workspaceId())).isZero();
        assertThat(jdbc.queryForObject("select count(*) from app.agent_run_command where requested_by=?", Integer.class, owner.userId())).isZero();
    }

    @Test void documentChunkPersistenceFailureRollsBackConfirmationThenExactRetrySucceeds() throws Exception {
        UUID run = completeAnalysis();
        var decision = postJson(owner, decisions(), new CreateAnalysisDecisionRequest(UUID.randomUUID(), run, 0, List.of(run + ":LEAN")), 200, AnalysisDecisionResponse.class);
        decision = postJson(owner, decisions() + "/" + decision.id() + "/confirm", confirmDecision(decision), 200, AnalysisDecisionResponse.class);
        var draft = postJson(owner, specifications(), new CreateSpecificationRequest(decision.id(), UUID.randomUUID()), 200, SpecificationResponse.class);
        String text = "connected_fixture_projection_failure connected_keyword 사용자 최종 확인";
        var edited = postJson(owner, specifications() + "/" + draft.id() + "/revisions",
            new ReviseSpecificationRequest(UUID.randomUUID(), draft.contentHash(), "트랜잭션 검증", text), 200, SpecificationResponse.class);
        // Real PostgreSQL failure injection, scoped to this synthetic sentinel and always removed.
        jdbc.execute("""
            create function app.connected_fixture_reject_chunk() returns trigger language plpgsql as $$
            begin
                if position('connected_fixture_projection_failure' in NEW.content) > 0 then
                    raise exception 'connected_fixture_projection_failure';
                end if;
                return NEW;
            end; $$
            """);
        jdbc.execute("create trigger connected_fixture_reject_chunk before insert on app.document_chunk for each row execute function app.connected_fixture_reject_chunk()");
        try {
            assertThatThrownBy(() -> mvc.perform(authorized(post(specifications() + "/" + edited.id() + "/confirm"), owner)
                .contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(confirmSpec(edited)))))
                .hasStackTraceContaining("connected_fixture_projection_failure");
            assertThat(getJson(owner, specifications() + "/" + edited.id(), SpecificationResponse.class).status()).isEqualTo("DRAFT");
            assertThat(jdbc.queryForObject("select count(*) from app.document where source_specification_id=?", Integer.class, edited.id())).isZero();
            assertThat(search(run, project.id(), QUERY)).isEmpty();
        } finally {
            jdbc.execute("drop trigger connected_fixture_reject_chunk on app.document_chunk");
            jdbc.execute("drop function app.connected_fixture_reject_chunk()");
        }
        var confirmed = postJson(owner, specifications() + "/" + edited.id() + "/confirm", confirmSpec(edited), 200, SpecificationResponse.class);
        assertThat(confirmed.id()).isEqualTo(edited.id());
        assertThat(search(run, project.id(), QUERY)).extracting(KnowledgeSearchResult::content).containsExactly(text);
    }

    @Test void concurrentRealHttpConfirmationsProduceOneLosslessKeywordProjection() throws Exception {
        UUID run = completeAnalysis();
        var decision = postJson(owner, decisions(), new CreateAnalysisDecisionRequest(UUID.randomUUID(), run, 0, List.of(run + ":LEAN")), 200, AnalysisDecisionResponse.class);
        decision = postJson(owner, decisions() + "/" + decision.id() + "/confirm", confirmDecision(decision), 200, AnalysisDecisionResponse.class);
        var draft = postJson(owner, specifications(), new CreateSpecificationRequest(decision.id(), UUID.randomUUID()), 200, SpecificationResponse.class);
        var edited = postJson(owner, specifications() + "/" + draft.id() + "/revisions",
            new ReviseSpecificationRequest(UUID.randomUUID(), draft.contentHash(), "동시 확정 검증", FINAL_BODY), 200, SpecificationResponse.class);
        var ready = new CountDownLatch(2);
        var go = new CountDownLatch(1);
        try (var pool = Executors.newFixedThreadPool(2)) {
            java.util.concurrent.Callable<SpecificationResponse> confirm = () -> {
                ready.countDown();
                if (!go.await(20, TimeUnit.SECONDS)) throw new AssertionError("confirmation barrier timed out");
                return postJson(owner, specifications() + "/" + edited.id() + "/confirm", confirmSpec(edited), 200, SpecificationResponse.class);
            };
            var first = pool.submit(confirm); var second = pool.submit(confirm);
            assertThat(ready.await(20, TimeUnit.SECONDS)).isTrue();
            go.countDown();
            var left = first.get(30, TimeUnit.SECONDS); var right = second.get(30, TimeUnit.SECONDS);
            assertThat(left.id()).isEqualTo(right.id());
            assertThat(left.reusableDocumentId()).isEqualTo(right.reusableDocumentId());
        }
        assertThat(jdbc.queryForObject("select count(*) from app.document where source_specification_id=?", Integer.class, edited.id())).isOne();
        assertThat(search(run, project.id(), QUERY)).extracting(KnowledgeSearchResult::content).containsExactly(FINAL_BODY);
    }

    private UUID completeAnalysis() throws Exception {
        UUID run = beginAnalysis(project, "PROJECT_ANALYSIS");
        var waiting = getJson(owner, workspace(owner) + "/agent-runs/" + run, AgentRunView.class);
        assertThat(waiting.status()).isEqualTo(AgentRunStatus.WAITING_FOR_USER);
        assertThat(waiting.interruption().questions()).containsExactly("누가 원본 자료를 제공하나요?");
        var resume = new ResumeAgentRunRequest(waiting.interruption().interruptionId(), "synthetic-resume-" + UUID.randomUUID(),
            List.of(new ResumeAgentRunRequest.ResumeAnswer(0, ANSWER)));
        var resumed = postJson(owner, workspace(owner) + "/agent-runs/" + run + "/responses", resume, 202, StartAgentRunResponse.class);
        assertThat(resumed.runId()).isEqualTo(run);
        dispatcher.dispatchPending();
        var completed = getJson(owner, workspace(owner) + "/agent-runs/" + run, AgentRunView.class);
        assertThat(completed.status()).isEqualTo(AgentRunStatus.COMPLETED);
        assertThat(completed.result().quotationDrafts()).extracting(value -> value.scenario()).containsExactly("LEAN", "RECOMMENDED", "EXPANDED");
        assertThat(completed.result().departmentResults()).hasSize(4).allMatch(value -> value.status().equals("COMPLETED"));
        assertThat(jdbc.queryForObject("select status from app.agent_interruption where id=?", String.class, resume.interruptionId())).isEqualTo("RESPONDED");
        assertThat(jdbc.queryForObject("select answers->0->>'answer' from app.agent_interruption where id=?", String.class, resume.interruptionId())).isEqualTo(ANSWER);
        assertThat(jdbc.queryForObject("select count(*) from app.source_message where project_id=? and run_id=? and kind='USER_CLARIFICATION' and content=?", Integer.class, project.id(), run, ANSWER)).isOne();
        assertThat(jdbc.queryForObject("select requirement_text from app.project where id=?", String.class, project.id())).isEqualTo(INPUT);
        assertThat(jdbc.queryForObject("select version from app.project where id=?", Long.class, project.id())).isZero();
        var source = mvc.perform(authorized(get(decisions() + "/sources/latest"), owner)).andExpect(status().isOk())
            .andExpect(jsonPath("runId").value(run.toString())).andExpect(jsonPath("sourceProjectVersion").value(0))
            .andExpect(jsonPath("sourceCurrent").value(true))
            .andExpect(jsonPath("view.status").value("COMPLETED")).andReturn();
        assertThat(source.getResponse().getContentAsString()).contains("PROPOSAL_LEAN", "PROPOSAL_RECOMMENDED", "PROPOSAL_EXPANDED");
        // HTTP start retry is a durable receipt, not a new live run or a QUEUED regression.
        var replay = mvc.perform(authorized(post(projectBase() + "/agent-runs"), owner)
            .header("Idempotency-Key", "start-" + project.id()).contentType(MediaType.APPLICATION_JSON)
            .content(mapper.writeValueAsString(startRequest(project, "PROJECT_ANALYSIS"))))
            .andExpect(status().isAccepted()).andExpect(jsonPath("runId").value(run.toString()))
            .andExpect(jsonPath("status").value("COMPLETED")).andReturn();
        assertThat(replay.getResponse().getContentAsString()).doesNotContain("QUEUED");
        assertThat(jdbc.queryForObject("select count(*) from app.agent_run where project_id=?", Integer.class, project.id())).isOne();
        assertThat(jdbc.queryForObject("select count(*) from app.agent_run_command where run_id=? and status='COMPLETED'", Integer.class, run)).isEqualTo(2);
        return run;
    }

    private UUID beginAnalysis(ProjectResponse target, String mode) throws Exception {
        String key = mode.equals("PROJECT_ANALYSIS") ? "start-" + target.id() : "adhoc-" + UUID.randomUUID();
        var response = mvc.perform(authorized(post(workspace(owner) + "/projects/" + target.id() + "/agent-runs"), owner)
            .header("Idempotency-Key", key).contentType(MediaType.APPLICATION_JSON)
            .content(mapper.writeValueAsString(startRequest(target, mode))))
            .andExpect(status().isAccepted()).andReturn();
        var accepted = mapper.readValue(response.getResponse().getContentAsString(), StartAgentRunResponse.class);
        assertThat(accepted.status()).isEqualTo(AgentRunStatus.QUEUED);
        assertThat(runs.findById(accepted.runId()).orElseThrow().sourceProjectVersion()).isZero();
        assertThat(runs.findById(accepted.runId()).orElseThrow().workflowMode()).isEqualTo(mode);
        dispatcher.dispatchPending();
        assertThat(starts).containsKey(accepted.runId());
        assertThat(starts.get(accepted.runId()).input().requirementText()).isEqualTo(target.requirementText());
        assertThat(starts.get(accepted.runId()).input().workflowMode()).isEqualTo(mode);
        assertThat(starts.get(accepted.runId()).input().petProfiles()).extracting(PetProfile::slot).containsExactly("LEAN", "RECOMMENDED", "EXPANDED");
        return accepted.runId();
    }

    private StartAgentRunRequest startRequest(ProjectResponse target, String mode) {
        return new StartAgentRunRequest(target.requirementText(), "ko-KR", null,
            new StartAgentRunRequest.ModelSelection(Provider.OPENAI, "gpt-6-luna", ReasoningEffort.LOW, credential),
            new StartAgentRunRequest.RunBudget(180, 2, 12, 20000, 1000, 4, 2, 0, 1, 3),
            new StartAgentRunRequest.SafetyContext(false, false, false, false, false, false, false),
            null, List.of(), null, mode, ByokCostNoticePolicy.VERSION);
    }

    private AgentRunView view(UUID run, AgentRunStatus status, boolean waiting) {
        var interruption = waiting ? new AgentRunView.AgentInterruption(UUID.nameUUIDFromBytes((run + ":clarification").getBytes(StandardCharsets.UTF_8)),
            InterruptionKind.CLARIFICATION, List.of("누가 원본 자료를 제공하나요?")) : null;
        var opinions = List.of(opinion("LEAN"), opinion("RECOMMENDED"), opinion("EXPANDED"));
        var departments = Arrays.stream(DepartmentName.values()).map(department -> new AgentRunView.DepartmentResult(department,
            "COMPLETED", "AI_UNCONFIRMED connected_keyword " + department, List.of(), List.of(), List.of(), null)).toList();
        var result = new AgentRunView.AgentRunResult("Synthetic project summary", List.of("OPEN_QUESTION_ONLY: 최종 납기 확인?"), departments, opinions.get(1), opinions);
        var profiles = starts.get(run).input().petProfiles();
        var metadata = new AgentRunView.AgentRunMetadata(Provider.OPENAI, "gpt-6-luna", "synthetic-prompt-v1", "synthetic-tools-v1", "synthetic-trace", credential, profiles);
        return new AgentRunView(run, status, waiting ? DepartmentName.REQUIREMENTS : null, interruption, result, null, metadata, null, Instant.now());
    }
    private AgentRunView.QuotationDraft opinion(String scenario) {
        return new AgentRunView.QuotationDraft(scenario, List.of(new AgentRunView.QuotationDraftItem("ITEM_" + scenario,
            "합성 범위 " + scenario, 1, "DAY", null, new AgentRunView.QuotationDraftBasis("ASSUMPTION", "ASSUMPTION_ONLY: 고객 확인 필요", null, null))),
            new AgentRunView.PetPerspective("PROPOSAL_" + scenario, "RATIONALE_" + scenario, "TRADEOFF_" + scenario));
    }
    private AuthTokenResponse registerAndLogin(String label) throws Exception {
        String email = label + "-" + UUID.randomUUID() + "@example.invalid";
        var registered = mapper.readValue(mvc.perform(post("/api/v2/auth/register").contentType(MediaType.APPLICATION_JSON)
            .content(mapper.writeValueAsString(new RegisterRequest(email, PASSWORD, "합성 사용자", "합성 작업공간", true))))
            .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString(), AuthTokenResponse.class);
        mvc.perform(post("/api/v2/auth/login").contentType(MediaType.APPLICATION_JSON)
            .content(mapper.writeValueAsString(new LoginRequest(email, "incorrect-password")))).andExpect(status().isUnauthorized());
        var login = mapper.readValue(mvc.perform(post("/api/v2/auth/login").contentType(MediaType.APPLICATION_JSON)
            .content(mapper.writeValueAsString(new LoginRequest(email, PASSWORD))))
            .andExpect(status().isOk()).andReturn().getResponse().getContentAsString(), AuthTokenResponse.class);
        assertThat(login.userId()).isEqualTo(registered.userId());
        assertThat(login.workspaceId()).isEqualTo(registered.workspaceId());
        assertThat(login.tokenType()).isEqualToIgnoringCase("Bearer");
        assertThat(jdbc.queryForObject("select password_hash from app.user_account where id=?", String.class, login.userId())).startsWith("$2").isNotEqualTo(PASSWORD);
        assertThat(jdbc.queryForObject("select count(*) from app.user_login_event where user_id=?", Integer.class, login.userId())).isEqualTo(2);
        mvc.perform(authorized(get("/api/v2/me"), login)).andExpect(status().isOk());
        return login;
    }
    private ProjectResponse createProject(AuthTokenResponse session, UUID customer, String title) throws Exception {
        return postJson(session, workspace(session) + "/projects", new CreateProjectRequest(customer, title, INPUT, "KRW", null, null, null), 201, ProjectResponse.class);
    }
    private List<KnowledgeSearchResult> search(UUID run, UUID projectId, String query) throws Exception {
        // Knowledge reads now require a live execution capability, not a completed-run control JWT.
        UUID execution = UUID.randomUUID();
        Instant acceptedAt = Instant.now();
        List<String> toolPermissions = List.of("agent.run", "project.read", "document.read");
        var active = runs.save(new com.freelanceops.backend.domain.agentrun.entity.AgentRunEntity(execution,
            owner.workspaceId(), projectId, UUID.randomUUID(), owner.userId(), Provider.OPENAI, "gpt-test", AgentRunStatus.RUNNING, acceptedAt));
        jdbc.update("insert into app.agent_run_command(id,run_id,command_type,payload,requested_by,effective_permissions,traceparent,status,available_at,created_at,updated_at) values (?,?,'START','{}',?,?,'trace','COMPLETED',?,?,?)",
            UUID.randomUUID(), execution, owner.userId(), mapper.writeValueAsString(toolPermissions),
            java.sql.Timestamp.from(acceptedAt), java.sql.Timestamp.from(acceptedAt), java.sql.Timestamp.from(acceptedAt));
        String token = tokens.issueForExecution(execution, owner.workspaceId(), projectId, owner.userId(),
            toolPermissions, active.createdAt().plusSeconds(active.budget().maxDurationSeconds()));
        var result = mvc.perform(post("/internal/v1/knowledge/search").header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
            .header("X-Run-Id", execution.toString()).contentType(MediaType.APPLICATION_JSON)
            .content(mapper.writeValueAsString(new KnowledgeSearchRequest(query, null, 10)))).andExpect(status().isOk()).andReturn();
        return mapper.readerForListOf(KnowledgeSearchResult.class).readValue(result.getResponse().getContentAsString());
    }
    private <T> T postJson(AuthTokenResponse session, String path, Object body, int expected, Class<T> type) throws Exception {
        return mapper.readValue(postStatus(session, path, body, expected).getResponse().getContentAsString(), type);
    }
    private MvcResult postStatus(AuthTokenResponse session, String path, Object body, int expected) throws Exception {
        return mvc.perform(authorized(post(path), session).contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(body)))
            .andExpect(status().is(expected)).andReturn();
    }
    private <T> T getJson(AuthTokenResponse session, String path, Class<T> type) throws Exception {
        return mapper.readValue(mvc.perform(authorized(get(path), session)).andExpect(status().isOk()).andReturn().getResponse().getContentAsString(), type);
    }
    private MockHttpServletRequestBuilder authorized(MockHttpServletRequestBuilder request, AuthTokenResponse session) {
        return request.header(HttpHeaders.AUTHORIZATION, "Bearer " + session.accessToken());
    }
    private ConfirmAnalysisDecisionRequest confirmDecision(AnalysisDecisionResponse value) { return new ConfirmAnalysisDecisionRequest(value.contentHash(), "CONFIRM_ANALYSIS_DECISION"); }
    private ConfirmSpecificationRequest confirmSpec(SpecificationResponse value) { return new ConfirmSpecificationRequest(value.contentHash(), "CONFIRM_SPECIFICATION"); }
    private String workspace(AuthTokenResponse session) { return "/api/v2/workspaces/" + session.workspaceId(); }
    private String projectBase() { return workspace(owner) + "/projects/" + project.id(); }
    private String decisions() { return projectBase() + "/analysis-decisions"; }
    private String specifications() { return projectBase() + "/specifications"; }
    private static KeyPair testKeys() {
        try { var generator = KeyPairGenerator.getInstance("RSA"); generator.initialize(2048); return generator.generateKeyPair(); }
        catch (Exception error) { throw new ExceptionInInitializerError(error); }
    }
    private static String hash(String text) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)));
    }
}
