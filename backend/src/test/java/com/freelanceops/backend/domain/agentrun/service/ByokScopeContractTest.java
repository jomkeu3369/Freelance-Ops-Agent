package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.client.dto.request.InternalAgentRunRequest.ByokBudget;
import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest.RunBudget;
import com.freelanceops.backend.domain.agentrun.model.*;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.json.JsonMapper;
import java.time.Instant;
import java.util.Set;
import java.util.UUID;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class ByokScopeContractTest {
    private final UUID id=UUID.randomUUID();
    private final RunBudget budget=new RunBudget(180,2,12,20000,1000,4,2,0,1,3);
    ByokBudget scope(String funding, String tier, int calls, RunBudget bound) {
        return new ByokBudget(id,id,id,id,id,id,Provider.OPENAI,"gpt-6-luna",ReasoningEffort.LOW,
            funding,tier,Instant.parse("2026-10-05T00:00:00Z"),calls,bound.maxInputTokens(),bound.maxOutputTokens(),bound,ByokCostNoticePolicy.VERSION);
    }
    @Test void contractRoundTripsFullBoundBudgetAndExplicitFunding() {
        var mapper=JsonMapper.builder().findAndAddModules().build();
        var original=scope("BYOK","default",2,budget);
        String payload=mapper.writeValueAsString(original);
        assertThat(payload).contains("\"fundingSource\":\"BYOK\"","\"serviceTier\":\"default\"","\"reasoningEffort\":\"LOW\"");
        assertThat(mapper.readValue(payload,ByokBudget.class)).isEqualTo(original);
        assertThat(mapper.readValue(payload,ByokBudget.class).costNoticeVersion()).isEqualTo(ByokCostNoticePolicy.VERSION);
        var legacy=new ByokBudget(id,id,id,id,id,id,Provider.OPENAI,"gpt-6-luna",ReasoningEffort.LOW,
            "BYOK","default",original.validUntil(),2,budget.maxInputTokens(),budget.maxOutputTokens(),budget);
        assertThat(mapper.writeValueAsString(legacy)).doesNotContain("costNoticeVersion");
        assertThat(mapper.readValue(mapper.writeValueAsString(legacy),ByokBudget.class)).isEqualTo(legacy);
        String omitted=mapper.writeValueAsString(legacy);
        String explicitNull=omitted.substring(0,omitted.length()-1)+",\"costNoticeVersion\":null}";
        assertThat(mapper.readValue(explicitNull,ByokBudget.class)).isEqualTo(legacy);
        var context=new com.freelanceops.backend.domain.agentrun.client.dto.request.InternalAgentRunRequest.TrustedRunContext(id,id,"trace",id,id,id,java.util.List.of("agent.run","project.read"));
        var selection=new com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest.ModelSelection(Provider.OPENAI,"gpt-6-luna",ReasoningEffort.LOW,id);
        var safety=new com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest.SafetyContext(false,false,false,false,false,false,false);
        var input=new com.freelanceops.backend.domain.agentrun.client.dto.request.InternalAgentRunRequest.AgentInput("Synthetic","en",null,null);
        var request=new com.freelanceops.backend.domain.agentrun.client.dto.request.InternalAgentRunRequest(context,budget,selection,safety,input,null,legacy);
        String requestOmitted=mapper.writeValueAsString(request);
        String requestNull=requestOmitted.replace("\"byokBudget\":{","\"byokBudget\":{\"costNoticeVersion\":null,");
        assertThat(requestNull).isNotEqualTo(requestOmitted);
        assertThat(mapper.readValue(requestOmitted,com.freelanceops.backend.domain.agentrun.client.dto.request.InternalAgentRunRequest.class))
            .isEqualTo(mapper.readValue(requestNull,com.freelanceops.backend.domain.agentrun.client.dto.request.InternalAgentRunRequest.class));
    }
    @Test void zeroAndMismatchedCapsOrPlatformFundingCannotFormPersonalScope() {
        assertThatThrownBy(() -> scope("PLATFORM","default",2,budget)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> scope("BYOK","flex",2,budget)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> scope("BYOK","default",3,budget)).isInstanceOf(IllegalArgumentException.class);
        var zero=new RunBudget(180,0,12,0,0,4,2,0,1,3);
        assertThatThrownBy(() -> scope("BYOK","default",0,zero)).isInstanceOf(IllegalArgumentException.class);
    }
    @Test void suppliedCredentialIdCannotSelectLargerPolicyBeforeCurrentAuthorization() {
        var jdbc=mock(JdbcTemplate.class);
        var connections=mock(AIConnectionService.class);
        var policy=mock(AgentBudgetPolicy.class);
        var service=new ByokExecutionService(jdbc,JsonMapper.builder().build(),connections,null,null,null,policy);
        doThrow(new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.NOT_FOUND))
            .when(connections).validate(id,id,id,Provider.OPENAI,"gpt-6-luna");
        var selection=new com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest.ModelSelection(Provider.OPENAI,"gpt-6-luna",ReasoningEffort.LOW,id);
        var larger=new RunBudget(180,50,12,150000,48000,4,2,2,2,3);
        assertThatThrownBy(() -> service.issue(id,id,id,id,selection,larger, ByokCostNoticePolicy.VERSION))
            .isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
        verifyNoInteractions(policy,jdbc);
    }

    @Test void missingDelegatedPermissionFailsBeforeAnyDatabaseOrCredentialAccess() {
        var jdbc=mock(JdbcTemplate.class);
        var connections=mock(AIConnectionService.class);
        var service=new ByokExecutionService(jdbc,JsonMapper.builder().build(),connections,null,null,null,mock(AgentBudgetPolicy.class));
        var principal=new ByokExecutionService.ExecutionPrincipal(id,id,id,id,Set.of("project.read"));
        assertThatThrownBy(() -> service.admit(id,null,principal)).isInstanceOf(ByokExecutionException.class);
        verifyNoInteractions(jdbc,connections);
    }
}
