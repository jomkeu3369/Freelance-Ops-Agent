package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.client.ProviderCredentialVerifier;
import com.freelanceops.backend.domain.agentrun.model.Provider;
import com.freelanceops.backend.domain.agentrun.security.CredentialCipher;
import com.freelanceops.backend.domain.workspace.policy.*;
import com.freelanceops.backend.domain.workspace.service.WorkspaceAuthorizationService;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;
import java.util.*;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class AIConnectionServiceTest {
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final WorkspaceAuthorizationService auth = mock(WorkspaceAuthorizationService.class);
    private final ProviderCredentialVerifier verifier = mock(ProviderCredentialVerifier.class);
    private final AIConnectionService service = new AIConnectionService(jdbc, new CredentialCipher(Base64.getEncoder().encodeToString(new byte[32])), auth, verifier, "test-model", "gemini-test");
    private final UUID user = UUID.randomUUID(), workspace = UUID.randomUUID(), id = UUID.randomUUID();

    @Test void rejectsRevokedMembershipBeforeDatabaseOrProviderAccess() {
        when(auth.authorize(user, workspace, PermissionCode.AGENT_RUN)).thenReturn(AuthorizationDecision.FORBIDDEN);
        assertThatThrownBy(() -> service.resolve(user, workspace, id, Provider.OPENAI, "test-model")).isInstanceOf(ResponseStatusException.class);
        assertThatThrownBy(() -> service.save(user, workspace, Provider.OPENAI, "test-model", "synthetic-key-1234")).isInstanceOf(ResponseStatusException.class);
        assertThatThrownBy(() -> service.delete(user, workspace, id)).isInstanceOf(ResponseStatusException.class);
        verifyNoInteractions(jdbc, verifier);
    }

    @Test void refusesUnknownModelAndNeverAcceptsKeyHeaderInjection() {
        when(auth.authorize(user, workspace, PermissionCode.AGENT_RUN)).thenReturn(AuthorizationDecision.ALLOWED);
        assertThatThrownBy(() -> service.save(user, workspace, Provider.OPENAI, "../../other", "synthetic-key-1234")).isInstanceOf(ResponseStatusException.class);
        assertThatThrownBy(() -> service.save(user, workspace, Provider.OPENAI, "test-model", "synthetic-key\r\nAuthorization: bad")).isInstanceOf(ResponseStatusException.class);
        verifyNoInteractions(jdbc, verifier);
    }

    @Test void scopesCredentialLookupToUserWorkspaceProviderAndModel() {
        when(auth.authorize(user, workspace, PermissionCode.AGENT_RUN)).thenReturn(AuthorizationDecision.ALLOWED);
        when(jdbc.queryForObject(anyString(), eq(Integer.class), eq(id), eq(workspace), eq(user), eq("OPENAI"), eq("test-model"))).thenReturn(0);
        assertThatThrownBy(() -> service.resolve(user, workspace, id, Provider.OPENAI, "test-model")).isInstanceOf(ResponseStatusException.class);
        verify(jdbc).queryForObject(contains("workspace_id = ? AND user_id = ? AND provider = ? AND model = ?"), eq(Integer.class), eq(id), eq(workspace), eq(user), eq("OPENAI"), eq("test-model"));
    }
}
