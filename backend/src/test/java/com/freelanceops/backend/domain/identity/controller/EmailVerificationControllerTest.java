package com.freelanceops.backend.domain.identity.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.freelanceops.backend.domain.identity.dto.request.ConfirmEmailVerificationRequest;
import com.freelanceops.backend.domain.identity.service.EmailVerificationService;

import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class EmailVerificationControllerTest {
    private final EmailVerificationService service = mock(EmailVerificationService.class);
    private final MockMvc mvc =
            MockMvcBuilders.standaloneSetup(new EmailVerificationController(service)).build();

    @Test
    void requestAndConfirmationKeepTheirStatusCodesAndJsonBodies() throws Exception {
        mvc.perform(
                        post("/api/v2/auth/email-verification/request")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"email\":\"member@example.test\"}"))
                .andExpect(status().isAccepted())
                .andExpect(content().json("{\"status\":\"IF_ELIGIBLE_CHECK_EMAIL\"}"));
        mvc.perform(
                        post("/api/v2/auth/email-verification/confirm")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"token\":\"confirmation-token\",\"password\":\"long-enough-password\"}"))
                .andExpect(status().isOk())
                .andExpect(content().json("{\"status\":\"VERIFIED\"}"));
        verify(service).request("member@example.test");
        verify(service).confirm("confirmation-token", "long-enough-password");
        verifyNoMoreInteractions(service);
    }

    @Test
    void validationStillRejectsInvalidEmailAndShortPasswordsBeforeDelegation() throws Exception {
        mvc.perform(
                        post("/api/v2/auth/email-verification/request")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"email\":\"invalid\"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(
                        post("/api/v2/auth/email-verification/confirm")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"token\":\"confirmation-token\",\"password\":\"short\"}"))
                .andExpect(status().isBadRequest());
        verifyNoInteractions(service);
    }

    @Test
    void confirmationStillRedactsTokenAndPasswordFromDiagnosticOutput() {
        assertThat(
                        new ConfirmEmailVerificationRequest("secret-token", "secret-password")
                                .toString())
                .isEqualTo("EmailVerificationConfirmation[redacted]");
    }
}
