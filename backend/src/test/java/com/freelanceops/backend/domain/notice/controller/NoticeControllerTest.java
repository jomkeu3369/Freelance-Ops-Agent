package com.freelanceops.backend.domain.notice.controller;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.freelanceops.backend.domain.notice.dto.response.NoticeResponse;
import com.freelanceops.backend.domain.notice.service.NoticeService;

import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

class NoticeControllerTest {
    private static final UUID ID = UUID.fromString("11111111-1111-4111-8111-111111111111");
    private static final Instant EFFECTIVE_AT = Instant.parse("2026-10-15T09:00:00Z");
    private static final String REQUEST =
            """
            {"kind":"OPERATIONAL","title":"Service update","body":"Details",
             "versionLabel":"v2","effectiveAt":"2026-10-15T09:00:00Z"}
            """;
    private static final String RESPONSE =
            """
            {"id":"11111111-1111-4111-8111-111111111111","kind":"OPERATIONAL",
             "title":"Service update","body":"Details","versionLabel":"v2",
             "effectiveAt":"2026-10-15T09:00:00Z","publishAt":null,
             "status":"DRAFT","contentHash":"hash","revision":1}
            """;
    private final NoticeService service = mock(NoticeService.class);
    private final MockMvc mvc =
            MockMvcBuilders.standaloneSetup(new NoticeController(service)).build();

    @Test
    void creationKeepsRequestFieldsAndTheFlatResponseShape() throws Exception {
        UUID actor = UUID.randomUUID();
        when(service.create(actor, "OPERATIONAL", "Service update", "Details", "v2", EFFECTIVE_AT))
                .thenReturn(notice());
        mvc.perform(
                        post("/api/v2/admin/notices")
                                .principal(
                                        new TestingAuthenticationToken(
                                                actor.toString(), "unused", "ROLE_USER"))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(REQUEST))
                .andExpect(status().isOk())
                .andExpect(content().json(RESPONSE));
        verify(service)
                .create(actor, "OPERATIONAL", "Service update", "Details", "v2", EFFECTIVE_AT);
    }

    @Test
    void publishedNoticesRemainAPublicJsonArray() throws Exception {
        when(service.published()).thenReturn(List.of(notice()));
        mvc.perform(get("/api/v2/notices"))
                .andExpect(status().isOk())
                .andExpect(content().json("[" + RESPONSE + "]"));
    }

    @Test
    void invalidDraftsAreRejectedBeforeCallingTheService() throws Exception {
        mvc.perform(
                        post("/api/v2/admin/notices")
                                .principal(
                                        new TestingAuthenticationToken(
                                                ID.toString(), "unused", "ROLE_USER"))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(REQUEST.replace("Service update", "")))
                .andExpect(status().isBadRequest());
        verifyNoInteractions(service);
    }

    private static NoticeResponse notice() {
        return new NoticeResponse(
                ID,
                "OPERATIONAL",
                "Service update",
                "Details",
                "v2",
                EFFECTIVE_AT,
                null,
                "DRAFT",
                "hash",
                1);
    }
}
