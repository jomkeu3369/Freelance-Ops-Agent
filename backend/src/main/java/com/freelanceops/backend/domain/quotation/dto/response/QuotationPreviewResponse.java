package com.freelanceops.backend.domain.quotation.dto.response;

import com.freelanceops.backend.domain.quotation.service.QuotationCalculator;

import io.swagger.v3.oas.annotations.media.Schema;

import java.math.BigDecimal;
import java.util.List;

@Schema(name = "Calculation")
public record QuotationPreviewResponse(
        List<Item> items,
        BigDecimal subtotal,
        BigDecimal discountTotal,
        BigDecimal riskBufferRate,
        BigDecimal riskBufferAmount,
        BigDecimal taxRate,
        BigDecimal taxAmount,
        BigDecimal total) {
    @Schema(name = "CalculatedItem")
    public record Item(BigDecimal subtotal, BigDecimal discountAmount, BigDecimal total) {}

    public static QuotationPreviewResponse from(QuotationCalculator.Calculation calculation) {
        return new QuotationPreviewResponse(
                calculation.items().stream()
                        .map(item -> new Item(item.subtotal(), item.discountAmount(), item.total()))
                        .toList(),
                calculation.subtotal(),
                calculation.discountTotal(),
                calculation.riskBufferRate(),
                calculation.riskBufferAmount(),
                calculation.taxRate(),
                calculation.taxAmount(),
                calculation.total());
    }
}
