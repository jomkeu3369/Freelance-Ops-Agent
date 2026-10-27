package com.freelanceops.backend.domain.client.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.freelanceops.backend.domain.client.dto.request.CreateClientRequest;
import com.freelanceops.backend.domain.client.dto.request.UpdateClientRequest;
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
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.web.server.ResponseStatusException;

import java.util.Optional;
import java.time.Instant;
import java.util.UUID;

@ExtendWith(MockitoExtension.class)
class ClientServiceTest {

    @Mock private ClientRepository clientRepository;
    @Mock private WorkspaceAuthorizationService authorizationService;

    @Test
    void createNormalizesContactAndUsesWorkspaceScope() {
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        when(authorizationService.authorize(userId, workspaceId, PermissionCode.CLIENT_WRITE))
                .thenReturn(AuthorizationDecision.ALLOWED);
        when(clientRepository.saveAndFlush(any()))
                .thenAnswer(invocation -> invocation.getArgument(0));
        ClientService service = new ClientService(clientRepository, authorizationService);

        service.create(
                userId,
                workspaceId,
                new CreateClientRequest(
                        " Client Name ",
                        " Company ",
                        " CLIENT@EXAMPLE.COM ",
                        " 010-0000-0000 ",
                        " Notes "));

        ArgumentCaptor<ClientEntity> captor = ArgumentCaptor.forClass(ClientEntity.class);
        verify(clientRepository).saveAndFlush(captor.capture());
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
                .isInstanceOfSatisfying(
                        ResponseStatusException.class,
                        error -> assertThat(error.getStatusCode().value()).isEqualTo(404));
        verify(clientRepository, never()).findByIdAndWorkspaceId(any(), any());
    }

    @Test
    void resourceLookupAlwaysIncludesWorkspaceId() {
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        UUID clientId = UUID.randomUUID();
        when(authorizationService.authorize(userId, workspaceId, PermissionCode.CLIENT_READ))
                .thenReturn(AuthorizationDecision.ALLOWED);
        when(clientRepository.findByIdAndWorkspaceId(clientId, workspaceId))
                .thenReturn(Optional.empty());
        ClientService service = new ClientService(clientRepository, authorizationService);

        assertThatThrownBy(() -> service.get(userId, workspaceId, clientId))
                .isInstanceOfSatisfying(
                        ResponseStatusException.class,
                        error -> assertThat(error.getStatusCode().value()).isEqualTo(404));
        verify(clientRepository).findByIdAndWorkspaceId(clientId, workspaceId);
    }

    @Test
    void duplicateActiveEmailIsReportedAsAConflict() {
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        when(authorizationService.authorize(userId, workspaceId, PermissionCode.CLIENT_WRITE))
                .thenReturn(AuthorizationDecision.ALLOWED);
        when(clientRepository.saveAndFlush(any()))
                .thenThrow(
                        new DataIntegrityViolationException(
                                "constraint uq_client_workspace_email_active"));
        ClientService service = new ClientService(clientRepository, authorizationService);

        assertThatThrownBy(
                        () ->
                                service.create(
                                        userId,
                                        workspaceId,
                                        new CreateClientRequest(
                                                "Client", null, "client@example.com", null, null)))
                .isInstanceOfSatisfying(
                        ResponseStatusException.class,
                        error -> assertThat(error.getStatusCode().value()).isEqualTo(409));
    }

    @Test
    void staleVersionIsRejectedBeforeAnyChangeIsSaved() {
        UUID userId = UUID.randomUUID(), workspaceId = UUID.randomUUID(), clientId = UUID.randomUUID();
        ClientEntity client = new ClientEntity(clientId, workspaceId, "Original", null, null, null, "Keep", userId, Instant.now());
        when(authorizationService.authorize(userId, workspaceId, PermissionCode.CLIENT_WRITE)).thenReturn(AuthorizationDecision.ALLOWED);
        when(clientRepository.findByIdAndWorkspaceId(clientId, workspaceId)).thenReturn(Optional.of(client));
        ClientService service = new ClientService(clientRepository, authorizationService);

        assertThatThrownBy(() -> service.update(userId, workspaceId, clientId, new UpdateClientRequest("Stale", null, null, null, "Overwrite", 1L)))
                .isInstanceOf(OptimisticLockingFailureException.class);
        assertThat(client.name()).isEqualTo("Original");
        assertThat(client.notes()).isEqualTo("Keep");
        verify(clientRepository, never()).saveAndFlush(any());
    }

    @Test
    void missingVersionFailsClosedEvenOutsideHttpValidation() {
        UUID userId = UUID.randomUUID(), workspaceId = UUID.randomUUID(), clientId = UUID.randomUUID();
        ClientEntity client = new ClientEntity(clientId, workspaceId, "Original", null, null, null, null, userId, Instant.now());
        when(authorizationService.authorize(userId, workspaceId, PermissionCode.CLIENT_WRITE)).thenReturn(AuthorizationDecision.ALLOWED);
        when(clientRepository.findByIdAndWorkspaceId(clientId, workspaceId)).thenReturn(Optional.of(client));
        ClientService service = new ClientService(clientRepository, authorizationService);

        assertThatThrownBy(() -> service.update(userId, workspaceId, clientId, new UpdateClientRequest("Changed", null, null, null, null, null)))
                .isInstanceOfSatisfying(ResponseStatusException.class, error -> assertThat(error.getStatusCode().value()).isEqualTo(400));
        verify(clientRepository, never()).saveAndFlush(any());
    }

    @Test
    void matchingVersionUpdatesAndFlushesTheClient() {
        UUID userId = UUID.randomUUID(), workspaceId = UUID.randomUUID(), clientId = UUID.randomUUID();
        ClientEntity client = new ClientEntity(clientId, workspaceId, "Original", null, null, null, null, userId, Instant.now());
        when(authorizationService.authorize(userId, workspaceId, PermissionCode.CLIENT_WRITE)).thenReturn(AuthorizationDecision.ALLOWED);
        when(clientRepository.findByIdAndWorkspaceId(clientId, workspaceId)).thenReturn(Optional.of(client));
        when(clientRepository.saveAndFlush(client)).thenReturn(client);

        var response = new ClientService(clientRepository, authorizationService).update(userId, workspaceId, clientId,
                new UpdateClientRequest(" Updated ", null, " USER@EXAMPLE.COM ", null, " Notes ", 0L));
        assertThat(response.name()).isEqualTo("Updated");
        assertThat(response.email()).isEqualTo("user@example.com");
        assertThat(response.notes()).isEqualTo("Notes");
        verify(clientRepository).saveAndFlush(client);
    }

    @Test
    void optimisticLockFailureDuringFlushIsNotTreatedAsSuccess() {
        UUID userId = UUID.randomUUID(), workspaceId = UUID.randomUUID(), clientId = UUID.randomUUID();
        ClientEntity client = new ClientEntity(clientId, workspaceId, "Original", null, null, null, null, userId, Instant.now());
        when(authorizationService.authorize(userId, workspaceId, PermissionCode.CLIENT_WRITE)).thenReturn(AuthorizationDecision.ALLOWED);
        when(clientRepository.findByIdAndWorkspaceId(clientId, workspaceId)).thenReturn(Optional.of(client));
        when(clientRepository.saveAndFlush(client)).thenThrow(new OptimisticLockingFailureException("changed during update"));

        assertThatThrownBy(() -> new ClientService(clientRepository, authorizationService).update(userId, workspaceId, clientId,
                new UpdateClientRequest("Changed", null, null, null, null, 0L))).isInstanceOf(OptimisticLockingFailureException.class);
    }

    @Test
    void archivedClientCannotBeEditedEvenWithMatchingVersion() {
        UUID userId = UUID.randomUUID(), workspaceId = UUID.randomUUID(), clientId = UUID.randomUUID();
        ClientEntity client = new ClientEntity(clientId, workspaceId, "Original", null, null, null, null, userId, Instant.now());
        client.archive(Instant.now());
        when(authorizationService.authorize(userId, workspaceId, PermissionCode.CLIENT_WRITE)).thenReturn(AuthorizationDecision.ALLOWED);
        when(clientRepository.findByIdAndWorkspaceId(clientId, workspaceId)).thenReturn(Optional.of(client));

        assertThatThrownBy(() -> new ClientService(clientRepository, authorizationService).update(userId, workspaceId, clientId,
                new UpdateClientRequest("Changed", null, null, null, null, 0L))).isInstanceOf(OptimisticLockingFailureException.class);
        verify(clientRepository, never()).saveAndFlush(any());
    }

    @Test
    void updateStillRequiresWorkspaceWritePermission() {
        UUID userId = UUID.randomUUID(), workspaceId = UUID.randomUUID(), clientId = UUID.randomUUID();
        when(authorizationService.authorize(userId, workspaceId, PermissionCode.CLIENT_WRITE)).thenReturn(AuthorizationDecision.FORBIDDEN);

        assertThatThrownBy(() -> new ClientService(clientRepository, authorizationService).update(userId, workspaceId, clientId,
                new UpdateClientRequest("Changed", null, null, null, null, 0L)))
                .isInstanceOfSatisfying(ResponseStatusException.class, error -> assertThat(error.getStatusCode().value()).isEqualTo(403));
        verify(clientRepository, never()).findByIdAndWorkspaceId(any(), any());
    }
}
