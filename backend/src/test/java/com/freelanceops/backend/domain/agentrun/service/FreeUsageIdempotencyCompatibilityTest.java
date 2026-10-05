package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest;
import com.freelanceops.backend.domain.agentrun.dto.response.StartAgentRunResponse;
import com.freelanceops.backend.domain.agentrun.model.AgentRunStatus;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.ObjectMapper;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.HexFormat;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class FreeUsageIdempotencyCompatibilityTest {
    @Test void absentNewQuoteKeepsExactLegacyRequestHash() throws Exception {
        var jdbc = mock(JdbcTemplate.class);
        var service = new FreeUsageService(jdbc, new ObjectMapper());
        UUID user = UUID.randomUUID(), workspace = UUID.randomUUID(), project = UUID.randomUUID(), run = UUID.randomUUID();
        String json = "{\"requirementText\":\"Synthetic input\",\"locale\":\"ko\",\"jurisdictionCode\":\"KR\",\"modelSelection\":null,\"budget\":null,\"safetyContext\":null}";
        String hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
            .digest((workspace + ":" + project + ":" + json).getBytes(StandardCharsets.UTF_8)));
        Instant acceptedAt = Instant.parse("2026-10-04T12:00:00Z");
        service.rememberStart(user, "legacy-request-key", workspace, project,
            new StartAgentRunRequest("Synthetic input", "ko", "KR", null, null, null),
            new StartAgentRunResponse(run, AgentRunStatus.QUEUED, acceptedAt));
        verify(jdbc).update(contains("INSERT INTO app.agent_start_idempotency"), eq(user), eq("legacy-request-key"),
            eq(hash), eq(run), eq(Timestamp.from(acceptedAt)));
    }

    @Test void attachmentsParticipateInByokHashAndEmptyAttachmentsPreserveQuotedHash() throws Exception {
        var jdbc = mock(JdbcTemplate.class);
        var mapper = new ObjectMapper();
        var service = new FreeUsageService(jdbc, mapper);
        UUID user = UUID.randomUUID(), workspace = UUID.randomUUID(), project = UUID.randomUUID(), run = UUID.randomUUID();
        Instant now = Instant.parse("2026-10-04T12:00:00Z");
        var receipt = UUID.randomUUID();
        var request = new StartAgentRunRequest("Synthetic input", "ko", "KR", null, null, null, null, java.util.List.of(receipt));
        String hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
            .digest((workspace + ":" + project + ":" + mapper.writeValueAsString(request)).getBytes(StandardCharsets.UTF_8)));
        service.rememberStart(user, "attachment-key", workspace, project, request,
            new StartAgentRunResponse(run, AgentRunStatus.QUEUED, now));
        verify(jdbc).update(contains("INSERT INTO app.agent_start_idempotency"), eq(user), eq("attachment-key"), eq(hash), eq(run), eq(Timestamp.from(now)));
        var quoted = new StartAgentRunRequest("Synthetic input", "ko", "KR", null, null, null, new StartAgentRunRequest.CreditQuote(10, now));
        org.junit.jupiter.api.Assertions.assertFalse(mapper.writeValueAsString(quoted).contains("attachmentIds"));
    }
    @Test void skillAndWorkflowChoicesAreIncludedInRetryHash() throws Exception {
        var jdbc = mock(JdbcTemplate.class);
        var mapper = new ObjectMapper();
        var service = new FreeUsageService(jdbc, mapper);
        UUID user = UUID.randomUUID(), workspace = UUID.randomUUID(), project = UUID.randomUUID(), run = UUID.randomUUID();
        Instant now = Instant.parse("2026-10-05T00:00:00Z");
        var manual = new com.freelanceops.backend.domain.agentrun.dto.SkillSelection("MANUAL", java.util.List.of(), java.util.List.of(), "1.0.0");
        var request = new StartAgentRunRequest("Synthetic input", "ko", "KR", null, null, null, null, java.util.List.of(), manual, "AD_HOC");
        String hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
            .digest((workspace + ":" + project + ":" + mapper.writeValueAsString(request)).getBytes(StandardCharsets.UTF_8)));
        service.rememberStart(user, "skill-key", workspace, project, request,
            new StartAgentRunResponse(run, AgentRunStatus.QUEUED, now));
        verify(jdbc).update(contains("INSERT INTO app.agent_start_idempotency"), eq(user), eq("skill-key"), eq(hash), eq(run), eq(Timestamp.from(now)));
    }

    @Test void costNoticeVersionIsHashedEvenWhenAllOtherOptionalFieldsAreAbsent() throws Exception {
        var jdbc=mock(JdbcTemplate.class);
        var mapper=new ObjectMapper();
        var service=new FreeUsageService(jdbc,mapper);
        UUID user=UUID.randomUUID(),workspace=UUID.randomUUID(),project=UUID.randomUUID(),run=UUID.randomUUID();
        var request=new StartAgentRunRequest("Synthetic input","ko","KR",null,null,null,null,java.util.List.of(),null,null,ByokCostNoticePolicy.VERSION);
        var now=Instant.parse("2026-10-05T00:00:00Z");
        String json=mapper.writeValueAsString(request);
        org.junit.jupiter.api.Assertions.assertTrue(json.contains("byokCostNoticeVersion"));
        String hash=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest((workspace+":"+project+":"+json).getBytes(StandardCharsets.UTF_8)));
        service.rememberStart(user,"notice-hash-key",workspace,project,request,new StartAgentRunResponse(run,AgentRunStatus.QUEUED,now));
        verify(jdbc).update(contains("INSERT INTO app.agent_start_idempotency"),eq(user),eq("notice-hash-key"),eq(hash),eq(run),eq(Timestamp.from(now)));
        var legacy=new StartAgentRunRequest("Synthetic input","ko","KR",null,null,null,null,java.util.List.of(),null,"AD_HOC");
        org.junit.jupiter.api.Assertions.assertFalse(mapper.writeValueAsString(legacy).contains("byokCostNoticeVersion"));
    }

}
