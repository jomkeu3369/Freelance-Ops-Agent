package com.freelanceops.backend.domain.client.service;

import com.freelanceops.backend.domain.client.dto.request.CreateClientRequest;
import com.freelanceops.backend.domain.client.dto.request.UpdateClientRequest;
import com.freelanceops.backend.domain.client.dto.response.ClientResponse;
import com.freelanceops.backend.domain.client.entity.ClientEntity;
import com.freelanceops.backend.domain.client.entity.ClientStatus;
import com.freelanceops.backend.domain.client.repository.ClientRepository;
import com.freelanceops.backend.domain.workspace.policy.AuthorizationDecision;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import com.freelanceops.backend.domain.workspace.service.WorkspaceAuthorizationService;
import org.springframework.http.HttpStatus;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

@Service
public class ClientService {

    private final ClientRepository clientRepository;
    private final WorkspaceAuthorizationService authorizationService;

    public ClientService(ClientRepository clientRepository, WorkspaceAuthorizationService authorizationService) {
        this.clientRepository = clientRepository;
        this.authorizationService = authorizationService;
    }

    @Transactional(readOnly = true)
    public List<ClientResponse> list(UUID userId, UUID workspaceId) {
        authorize(userId, workspaceId, PermissionCode.CLIENT_READ);
        return clientRepository.findAllByWorkspaceIdAndStatusOrderByUpdatedAtDesc(workspaceId, ClientStatus.ACTIVE.name())
            .stream().map(ClientService::response).toList();
    }

    @Transactional(readOnly = true)
    public ClientResponse get(UUID userId, UUID workspaceId, UUID clientId) {
        authorize(userId, workspaceId, PermissionCode.CLIENT_READ);
        return response(find(workspaceId, clientId));
    }

    @Transactional
    public ClientResponse create(UUID userId, UUID workspaceId, CreateClientRequest request) {
        authorize(userId, workspaceId, PermissionCode.CLIENT_WRITE);
        Instant now = Instant.now();
        ClientEntity client = new ClientEntity(UUID.randomUUID(), workspaceId, request.name().trim(), trim(request.companyName()), normalizeEmail(request.email()), trim(request.phone()), trim(request.notes()), userId, now);
        return response(persist(client));
    }

    @Transactional
    public ClientResponse update(UUID userId, UUID workspaceId, UUID clientId, UpdateClientRequest request) {
        authorize(userId, workspaceId, PermissionCode.CLIENT_WRITE);
        ClientEntity client = find(workspaceId, clientId);
        client.update(request.name().trim(), trim(request.companyName()), normalizeEmail(request.email()), trim(request.phone()), trim(request.notes()), Instant.now());
        return response(persist(client));
    }

    @Transactional
    public void archive(UUID userId, UUID workspaceId, UUID clientId) {
        authorize(userId, workspaceId, PermissionCode.CLIENT_DELETE);
        ClientEntity client = find(workspaceId, clientId);
        client.archive(Instant.now());
        clientRepository.save(client);
    }

    private ClientEntity find(UUID workspaceId, UUID clientId) {
        return clientRepository.findByIdAndWorkspaceId(clientId, workspaceId)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
    }

    private void authorize(UUID userId, UUID workspaceId, PermissionCode permission) {
        AuthorizationDecision decision = authorizationService.authorize(userId, workspaceId, permission);
        if (decision == AuthorizationDecision.NOT_FOUND) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
        if (decision == AuthorizationDecision.FORBIDDEN) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        }
    }

    private static String trim(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private static String normalizeEmail(String value) {
        String trimmed = trim(value);
        return trimmed == null ? null : trimmed.toLowerCase(Locale.ROOT);
    }

    private ClientEntity persist(ClientEntity client) {
        try {
            return clientRepository.saveAndFlush(client);
        } catch (DataIntegrityViolationException error) {
            if (causedBy(error, "uq_client_workspace_email_active")) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "an active client already uses this email", error);
            }
            throw error;
        }
    }

    private static boolean causedBy(Throwable error, String constraintName) {
        for (Throwable cause = error; cause != null; cause = cause.getCause()) {
            if (cause.getMessage() != null && cause.getMessage().contains(constraintName)) return true;
        }
        return false;
    }

    private static ClientResponse response(ClientEntity client) {
        return new ClientResponse(client.id(), client.workspaceId(), client.name(), client.companyName(), client.email(), client.phone(), client.notes(), ClientStatus.valueOf(client.status()), client.createdBy(), client.createdAt(), client.updatedAt(), client.version());
    }
}
