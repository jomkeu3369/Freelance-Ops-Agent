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
            funding,tier,Instant.parse("2026-10-05T00:00:00Z"),calls,bound.maxInputTokens(),bound.maxOutputTokens(),bound);
    }
    @Test void contractRoundTripsFullBoundBudgetAndExplicitFunding() {
        var mapper=JsonMapper.builder().findAndAddModules().build();
        var original=scope("BYOK","default",2,budget);
        String payload=mapper.writeValueAsString(original);
        assertThat(payload).contains("\"fundingSource\":\"BYOK\"","\"serviceTier\":\"default\"","\"reasoningEffort\":\"LOW\"");
        assertThat(mapper.readValue(payload,ByokBudget.class)).isEqualTo(original);
    }
    @Test void zeroAndMismatchedCapsOrPlatformFundingCannotFormPersonalScope() {
        assertThatThrownBy(() -> scope("PLATFORM","default",2,budget)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> scope("BYOK","flex",2,budget)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> scope("BYOK","default",3,budget)).isInstanceOf(IllegalArgumentException.class);
        var zero=new RunBudget(180,0,12,0,0,4,2,0,1,3);
        assertThatThrownBy(() -> scope("BYOK","default",0,zero)).isInstanceOf(IllegalArgumentException.class);
    }
    @Test void missingDelegatedPermissionFailsBeforeAnyDatabaseOrCredentialAccess() {
        var jdbc=mock(JdbcTemplate.class);
        var connections=mock(AIConnectionService.class);
        var service=new ByokExecutionService(jdbc,JsonMapper.builder().build(),connections,null,null,null);
        var principal=new ByokExecutionService.ExecutionPrincipal(id,id,id,id,Set.of("project.read"));
        assertThatThrownBy(() -> service.admit(id,null,principal)).isInstanceOf(ByokExecutionException.class);
        verifyNoInteractions(jdbc,connections);
    }
}
