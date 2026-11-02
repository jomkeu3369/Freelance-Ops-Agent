package com.freelanceops.backend.domain.quotation.controller;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.freelanceops.backend.domain.quotation.service.QuotationAssumptionService;
import com.freelanceops.backend.domain.quotation.service.QuotationCalculator;
import com.freelanceops.backend.domain.quotation.service.QuotationService;

import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

class ProjectQuotationControllerTest {
    @Test
    void previewKeepsItsJsonFieldsAndDecimalValuesWithoutExposingCalculationTypes()
            throws Exception {
        var service = mock(QuotationService.class);
        var mvc =
                MockMvcBuilders.standaloneSetup(
                                new ProjectQuotationController(
                                        service, mock(QuotationAssumptionService.class)))
                        .build();
        UUID user = UUID.randomUUID(), workspace = UUID.randomUUID(), project = UUID.randomUUID();
        var calculation =
                new QuotationCalculator()
                        .calculate(
                                List.of(
                                        new QuotationCalculator.ItemInput(
                                                BigDecimal.ONE,
                                                new BigDecimal("200"),
                                                BigDecimal.ZERO,
                                                new BigDecimal("0.1"))),
                                new BigDecimal("0.2"),
                                new BigDecimal("0.1"));
        when(service.preview(eq(user), eq(workspace), eq(project), any())).thenReturn(calculation);

        mvc.perform(
                        post("/api/v2/workspaces/"
                                        + workspace
                                        + "/projects/"
                                        + project
                                        + "/quotations/preview")
                                .principal(
                                        new TestingAuthenticationToken(
                                                user.toString(), "unused", "ROLE_USER"))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                {"scenario":"RECOMMENDED","currency":"KRW","taxRate":0.1,
                                 "applyDefaultRiskBuffer":true,"items":[{"title":"Feature",
                                 "quantity":1,"unit":"DAY","unitRate":200,"discountRate":0.1,
                                 "basis":{"type":"ASSUMPTION","content":"One screen"}}]}
                                """))
                .andExpect(status().isOk())
                .andExpect(
                        content()
                                .json(
                                        """
                        {"items":[{"subtotal":200.00,"discountAmount":20.00,"total":180.00}],
                         "subtotal":200.00,"discountTotal":20.00,"riskBufferRate":0.2,
                         "riskBufferAmount":36.00,"taxRate":0.1,"taxAmount":21.60,"total":237.60}
                        """));
        verify(service).preview(eq(user), eq(workspace), eq(project), any());
    }
}
