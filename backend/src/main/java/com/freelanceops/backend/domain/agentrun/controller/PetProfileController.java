package com.freelanceops.backend.domain.agentrun.controller;

import com.freelanceops.backend.domain.agentrun.client.PetGenerationClient;
import com.freelanceops.backend.domain.agentrun.dto.PetProfile;
import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest.ModelSelection;
import com.freelanceops.backend.domain.agentrun.service.PetProfileService;
import com.freelanceops.backend.domain.agentrun.service.PetGenerationService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.springframework.http.*;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import java.util.*;

@RestController
@RequestMapping("/api/v2/workspaces/{workspaceId}")
public class PetProfileController {
    private final PetProfileService profiles;
    private final PetGenerationService generation;
    public PetProfileController(PetProfileService profiles, PetGenerationService generation) { this.profiles = profiles; this.generation = generation; }
    public record Generate(@NotNull @Valid ModelSelection modelSelection, @NotBlank @Size(max = 500) String description,
        @NotNull @Pattern(regexp = "LEAN|RECOMMENDED|EXPANDED") String slot) {}

    @GetMapping("/pets")
    public ResponseEntity<List<PetProfile>> list(@PathVariable UUID workspaceId, Authentication auth) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(profiles.list(UUID.fromString(auth.getName()), workspaceId));
    }
    @PutMapping("/pets")
    public ResponseEntity<PetProfile> save(@PathVariable UUID workspaceId, Authentication auth, @Valid @RequestBody PetProfile profile) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(profiles.save(UUID.fromString(auth.getName()), workspaceId, profile));
    }
    @PostMapping("/projects/{projectId}/pet-generations")
    public ResponseEntity<PetGenerationClient.Output> generate(@PathVariable UUID workspaceId, @PathVariable UUID projectId, Authentication auth, @Valid @RequestBody Generate input) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(generation.generate(UUID.fromString(auth.getName()), workspaceId, projectId, input.modelSelection(), input.description(), input.slot()));
    }
}
