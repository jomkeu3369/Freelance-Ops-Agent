package com.freelanceops.backend.domain.identity.dto.request;

import io.swagger.v3.oas.annotations.media.Schema;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

@Schema(name = "Address")
public record RequestEmailVerificationRequest(@NotBlank @Email @Size(max = 320) String email) {}
