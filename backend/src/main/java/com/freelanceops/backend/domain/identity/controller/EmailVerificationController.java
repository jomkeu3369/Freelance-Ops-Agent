package com.freelanceops.backend.domain.identity.controller;

import com.freelanceops.backend.domain.identity.service.EmailVerificationService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v2/auth/email-verification")
public class EmailVerificationController {
    private final EmailVerificationService service;
    public EmailVerificationController(EmailVerificationService service) { this.service = service; }
    @PostMapping("/request")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public Status request(@Valid @RequestBody Address input) {
        service.request(input.email());
        return new Status("IF_ELIGIBLE_CHECK_EMAIL");
    }
    @PostMapping("/confirm")
    public Status confirm(@Valid @RequestBody Confirmation input) {
        service.confirm(input.token(), input.password());
        return new Status("VERIFIED");
    }
    public record Address(@NotBlank @Email @Size(max = 320) String email) { }
    public record Confirmation(@NotBlank @Size(max = 128) String token, @NotBlank @Size(min = 12, max = 72) String password) {
        @Override public String toString() { return "EmailVerificationConfirmation[redacted]"; }
    }
    public record Status(String status) { }
}
