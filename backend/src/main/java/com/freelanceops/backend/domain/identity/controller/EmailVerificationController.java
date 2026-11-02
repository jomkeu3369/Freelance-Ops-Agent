package com.freelanceops.backend.domain.identity.controller;

import com.freelanceops.backend.domain.identity.dto.request.ConfirmEmailVerificationRequest;
import com.freelanceops.backend.domain.identity.dto.request.RequestEmailVerificationRequest;
import com.freelanceops.backend.domain.identity.dto.response.EmailVerificationStatusResponse;
import com.freelanceops.backend.domain.identity.service.EmailVerificationService;

import jakarta.validation.Valid;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v2/auth/email-verification")
public class EmailVerificationController {
    private final EmailVerificationService service;

    public EmailVerificationController(EmailVerificationService service) {
        this.service = service;
    }

    @PostMapping("/request")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public EmailVerificationStatusResponse request(@Valid @RequestBody RequestEmailVerificationRequest input) {
        service.request(input.email());
        return new EmailVerificationStatusResponse("IF_ELIGIBLE_CHECK_EMAIL");
    }

    @PostMapping("/confirm")
    public EmailVerificationStatusResponse confirm(@Valid @RequestBody ConfirmEmailVerificationRequest input) {
        service.confirm(input.token(), input.password());
        return new EmailVerificationStatusResponse("VERIFIED");
    }

}
