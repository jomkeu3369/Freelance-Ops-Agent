package com.freelanceops.backend.domain.agentrun.controller;

import com.freelanceops.backend.domain.agentrun.dto.PetProfile;
import com.freelanceops.backend.domain.agentrun.service.CustomAgentPetService;
import jakarta.validation.Valid;
import org.springframework.http.*;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import java.util.UUID;

@RestController
@RequestMapping("/api/v2/workspaces/{workspaceId}/agent-pets")
public class CustomAgentPetController {
    private final CustomAgentPetService pets;
    public CustomAgentPetController(CustomAgentPetService pets) { this.pets = pets; }
    @GetMapping
    public ResponseEntity<CustomAgentPetService.Collection> list(@PathVariable UUID workspaceId, Authentication auth) {
        return response(pets.list(UUID.fromString(auth.getName()), workspaceId));
    }
    @PostMapping("/preview")
    public ResponseEntity<PetProfile> preview(@PathVariable UUID workspaceId, Authentication auth, @Valid @RequestBody CustomAgentPetService.Compose input) {
        return response(pets.preview(UUID.fromString(auth.getName()), workspaceId, input));
    }
    @PostMapping
    public ResponseEntity<CustomAgentPetService.Pet> save(@PathVariable UUID workspaceId, Authentication auth, @Valid @RequestBody CustomAgentPetService.Compose input) {
        return response(pets.save(UUID.fromString(auth.getName()), workspaceId, input));
    }
    @PatchMapping("/{id}")
    public ResponseEntity<Void> change(@PathVariable UUID workspaceId, @PathVariable UUID id, Authentication auth, @Valid @RequestBody CustomAgentPetService.Change input) {
        pets.change(UUID.fromString(auth.getName()), workspaceId, id, input);
        return response(null);
    }
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable UUID workspaceId, @PathVariable UUID id, @RequestParam long revision, Authentication auth) {
        pets.delete(UUID.fromString(auth.getName()), workspaceId, id, revision);
        return response(null);
    }
    private static <T> ResponseEntity<T> response(T value) { return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(value); }
}
