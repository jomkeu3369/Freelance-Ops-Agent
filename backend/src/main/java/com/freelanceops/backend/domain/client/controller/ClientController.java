package com.freelanceops.backend.domain.client.controller;

import com.freelanceops.backend.domain.client.dto.request.CreateClientRequest;
import com.freelanceops.backend.domain.client.dto.request.UpdateClientRequest;
import com.freelanceops.backend.domain.client.dto.response.ClientResponse;
import com.freelanceops.backend.domain.client.service.ClientService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/v2/workspaces/{workspaceId}/clients")
public class ClientController {

    private final ClientService clientService;

    public ClientController(ClientService clientService) {
        this.clientService = clientService;
    }

    @GetMapping
    public List<ClientResponse> list(@PathVariable UUID workspaceId, Authentication authentication) {
        return clientService.list(userId(authentication), workspaceId);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public ClientResponse create(@PathVariable UUID workspaceId, @Valid @RequestBody CreateClientRequest request, Authentication authentication) {
        return clientService.create(userId(authentication), workspaceId, request);
    }

    @GetMapping("/{clientId}")
    public ClientResponse get(@PathVariable UUID workspaceId, @PathVariable UUID clientId, Authentication authentication) {
        return clientService.get(userId(authentication), workspaceId, clientId);
    }

    @PatchMapping("/{clientId}")
    public ClientResponse update(@PathVariable UUID workspaceId, @PathVariable UUID clientId, @Valid @RequestBody UpdateClientRequest request, Authentication authentication) {
        return clientService.update(userId(authentication), workspaceId, clientId, request);
    }

    @DeleteMapping("/{clientId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void archive(@PathVariable UUID workspaceId, @PathVariable UUID clientId, Authentication authentication) {
        clientService.archive(userId(authentication), workspaceId, clientId);
    }

    private static UUID userId(Authentication authentication) {
        try {
            return UUID.fromString(authentication.getName());
        } catch (IllegalArgumentException error) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "authenticated subject must be a UUID", error);
        }
    }
}
