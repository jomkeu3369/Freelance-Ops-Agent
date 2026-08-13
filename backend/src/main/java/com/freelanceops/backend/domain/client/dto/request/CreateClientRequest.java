package com.freelanceops.backend.domain.client.dto.request;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record CreateClientRequest(
    @NotBlank @Size(max = 120) String name,
    @Size(max = 160) String companyName,
    @Email @Size(max = 320) String email,
    @Size(max = 40) String phone,
    @Size(max = 5000) String notes
) {
}
