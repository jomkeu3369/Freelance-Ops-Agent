package com.freelanceops.backend.domain.identity.controller;

import com.freelanceops.backend.domain.identity.dto.request.RegisterRequest;
import com.freelanceops.backend.domain.identity.service.AuthService;
import com.freelanceops.backend.domain.internaltool.security.DelegationTokenFilter;
import com.freelanceops.backend.global.config.AuthSecurityConfig;
import com.freelanceops.backend.global.config.SecurityConfig;
import jakarta.servlet.FilterChain;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.ObjectMapper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(
    controllers = AuthController.class,
    properties = {
        "app.auth.jwt-secret=test-web-auth-secret-with-at-least-32-bytes",
        "app.auth.issuer=test-issuer",
        "app.auth.audience=test-web"
    }
)
@Import({SecurityConfig.class, AuthSecurityConfig.class})
class RegistrationPayloadCompatibilityWebTest {

    private static final String BASE_JSON = """
        {"email":"compatibility@example.invalid","password":"synthetic-test-password",
         "displayName":"Synthetic Test","workspaceName":"Synthetic Workspace"}
        """.strip();

    @Autowired
    private MockMvc mockMvc;
    @Autowired
    private ObjectMapper objectMapper;
    @MockitoBean
    private AuthService authService;
    @MockitoBean
    private DelegationTokenFilter delegationTokenFilter;

    @BeforeEach
    void letPublicRequestsPassDelegationFilter() throws Exception {
        doAnswer(invocation -> {
            FilterChain chain = invocation.getArgument(2);
            chain.doFilter(invocation.getArgument(0), invocation.getArgument(1));
            return null;
        }).when(delegationTokenFilter).doFilter(any(), any(), any());
    }

    @Test
    void legacyPayloadWithoutAgeAttestationRemainsAccepted() throws Exception {
        assertAccepted(BASE_JSON, null);
    }

    @Test
    void explicitTrueAttestationRemainsAccepted() throws Exception {
        assertAccepted(withProperty("\"ageAtLeast14\":true"), true);
    }

    @Test
    void explicitFalseAttestationIsAcceptedUntilEnforcementRollout() throws Exception {
        assertAccepted(withProperty("\"ageAtLeast14\":false"), false);
    }

    @Test
    void explicitNullAttestationRemainsAcceptedDuringTransition() throws Exception {
        assertAccepted(withProperty("\"ageAtLeast14\":null"), null);
    }

    @Test
    void legacyJavaConstructorLeavesAgeAttestationAbsent() {
        RegisterRequest request = new RegisterRequest(
            "compatibility@example.invalid", "synthetic-test-password", "Synthetic Test", "Synthetic Workspace"
        );
        assertThat(request.ageAtLeast14()).isNull();
    }

    @Test
    void unrelatedUnknownPropertyIsStillRejectedByApplicationConfiguration() throws Exception {
        assertThat(objectMapper.isEnabled(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)).isTrue();
        var result = mockMvc.perform(post("/api/v2/auth/register")
                .contentType("application/json")
                .content(withProperty("\"unrecognizedProperty\":true")))
            .andExpect(status().isBadRequest())
            .andReturn();

        assertThat(result.getResolvedException()).isInstanceOf(HttpMessageNotReadableException.class);
        assertThat(result.getResolvedException()).hasMessageContaining("unrecognizedProperty");
        verifyNoInteractions(authService);
    }

    @ParameterizedTest
    @ValueSource(strings = {"\"true\"", "\"false\"", "1", "0", "\"\""})
    void nonBooleanAttestationsAreRejectedBeforeRegistration(String value) throws Exception {
        var result = mockMvc.perform(post("/api/v2/auth/register")
                .contentType("application/json")
                .content(withProperty("\"ageAtLeast14\":" + value)))
            .andExpect(status().isBadRequest())
            .andReturn();

        assertThat(result.getResolvedException()).isInstanceOf(HttpMessageNotReadableException.class);
        verifyNoInteractions(authService);
    }

    private void assertAccepted(String payload, Boolean ageAtLeast14) throws Exception {
        mockMvc.perform(post("/api/v2/auth/register")
                .contentType("application/json")
                .content(payload))
            .andExpect(status().isCreated());

        verify(authService).register(new RegisterRequest(
            "compatibility@example.invalid", "synthetic-test-password", "Synthetic Test", "Synthetic Workspace", ageAtLeast14
        ));
    }

    private static String withProperty(String property) {
        return BASE_JSON.substring(0, BASE_JSON.length() - 1) + "," + property + "}";
    }
}
