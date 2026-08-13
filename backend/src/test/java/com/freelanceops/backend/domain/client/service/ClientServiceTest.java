package com.freelanceops.backend.domain.client.service;

import com.freelanceops.backend.domain.client.dto.request.CreateClientRequest;
import com.freelanceops.backend.domain.client.entity.ClientEntity;
import com.freelanceops.backend.domain.client.repository.ClientRepository;
import com.freelanceops.backend.domain.workspace.policy.AuthorizationDecision;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import com.freelanceops.backend.domain.workspace.service.WorkspaceAuthorizationService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.web.server.ResponseStatusException;

import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class ClientServiceTest {

    @Mock
    private ClientRepository clientRepository;
    @Mock
    private WorkspaceAuthorizationService authorizationService;

    @Test
    void createNormalizesContactAndUsesWorkspaceScope() {
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        when(authorizationService.authorize(userId, workspaceId, PermissionCode.CLIENT_WRITE))
            .thenReturn(AuthorizationDecision.ALLOWED);
        when(clientRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        ClientService service = new ClientService(clientRepository, authorizationService);

        service.create(userId, workspaceId, new CreateClientRequest(
            " Client Name ",
            " Company ",
            " CLIENT@EXAMPLE.COM ",
            " 010-0000-0000 ",
            " Notes "
        ));

        ArgumentCaptor<ClientEntity> captor = ArgumentCaptor.forClass(ClientEntity.class);
        verify(clientRepository).save(captor.capture());
        assertThat(captor.getValue().workspaceId()).isEqualTo(workspaceId);
        assertThat(captor.getValue().email()).isEqualTo("client@example.com");
        assertThat(captor.getValue().name()).isEqualTo("Client Name");
    }

    @Test
    void missingWorkspaceIsHiddenBeforeRepositoryAccess() {
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        when(authorizationService.authorize(userId, workspaceId, PermissionCode.CLIENT_READ))
            .thenReturn(AuthorizationDecision.NOT_FOUND);
        ClientService service = new ClientService(clientRepository, authorizationService);

        assertThatThrownBy(() -> service.get(userId, workspaceId, UUID.randomUUID()))
            .isInstanceOfSatisfying(ResponseStatusException.class, error ->
                assertThat(error.getStatusCode().value()).isEqualTo(404));
        verify(clientRepository, never()).findByIdAndWorkspaceId(any(), any());
    }

    @Test
    void resourceLookupAlwaysIncludesWorkspaceId() {
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        UUID clientId = UUID.randomUUID();
        when(authorizationService.authorize(userId, workspaceId, PermissionCode.CLIENT_READ))
            .thenReturn(AuthorizationDecision.ALLOWED);
        when(clientRepository.findByIdAndWorkspaceId(clientId, workspaceId)).thenReturn(Optional.empty());
        ClientService service = new ClientService(clientRepository, authorizationService);

        assertThatThrownBy(() -> service.get(userId, workspaceId, clientId))
            .isInstanceOfSatisfying(ResponseStatusException.class, error ->
                assertThat(error.getStatusCode().value()).isEqualTo(404));
        verify(clientRepository).findByIdAndWorkspaceId(clientId, workspaceId);
    }
}
