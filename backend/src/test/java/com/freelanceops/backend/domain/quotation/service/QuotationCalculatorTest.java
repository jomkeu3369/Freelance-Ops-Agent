package com.freelanceops.backend.domain.quotation.service;

import org.junit.jupiter.api.Test;
import java.math.BigDecimal;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class QuotationCalculatorTest {
    private final QuotationCalculator calculator = new QuotationCalculator();

    @Test
    void calculatesMinimumDiscountRiskTaxAndTotalDeterministically() {
        var result = calculator.calculate(
            List.of(
                new QuotationCalculator.ItemInput(new BigDecimal("3"), new BigDecimal("100000"), BigDecimal.ZERO, new BigDecimal("0.10")),
                new QuotationCalculator.ItemInput(BigDecimal.ONE, new BigDecimal("10000"), new BigDecimal("50000"), BigDecimal.ZERO)
            ),
            new BigDecimal("0.20"),
            new BigDecimal("0.10")
        );

        assertThat(result.subtotal()).isEqualByComparingTo("350000.00");
        assertThat(result.discountTotal()).isEqualByComparingTo("30000.00");
        assertThat(result.riskBufferAmount()).isEqualByComparingTo("64000.00");
        assertThat(result.taxAmount()).isEqualByComparingTo("38400.00");
        assertThat(result.total()).isEqualByComparingTo("422400.00");
    }
}
