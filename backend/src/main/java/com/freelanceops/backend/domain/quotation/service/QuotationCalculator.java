package com.freelanceops.backend.domain.quotation.service;

import org.springframework.stereotype.Component;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.List;

@Component
public class QuotationCalculator {
    private static final int MONEY_SCALE = 2;

    public Calculation calculate(List<ItemInput> inputs, BigDecimal riskBufferRate, BigDecimal taxRate) {
        List<CalculatedItem> items = inputs.stream().map(this::calculateItem).toList();
        BigDecimal subtotal = money(items.stream().map(CalculatedItem::subtotal).reduce(BigDecimal.ZERO, BigDecimal::add));
        BigDecimal discountTotal = money(items.stream().map(CalculatedItem::discountAmount).reduce(BigDecimal.ZERO, BigDecimal::add));
        BigDecimal net = money(items.stream().map(CalculatedItem::total).reduce(BigDecimal.ZERO, BigDecimal::add));
        BigDecimal riskBufferAmount = money(net.multiply(riskBufferRate));
        BigDecimal taxable = money(net.add(riskBufferAmount));
        BigDecimal taxAmount = money(taxable.multiply(taxRate));
        return new Calculation(items, subtotal, discountTotal, riskBufferRate, riskBufferAmount, taxRate, taxAmount, money(taxable.add(taxAmount)));
    }

    private CalculatedItem calculateItem(ItemInput input) {
        if (input.quantity().signum() <= 0 || input.unitRate().signum() < 0 || input.minimumAmount().signum() < 0) {
            throw new IllegalArgumentException("quantity and rates must be non-negative");
        }
        if (input.discountRate().signum() < 0 || input.discountRate().compareTo(BigDecimal.ONE) > 0) {
            throw new IllegalArgumentException("discount rate must be between zero and one");
        }
        BigDecimal rawSubtotal = input.quantity().multiply(input.unitRate());
        BigDecimal subtotal = money(rawSubtotal.max(input.minimumAmount()));
        BigDecimal discountAmount = money(subtotal.multiply(input.discountRate()));
        return new CalculatedItem(subtotal, discountAmount, money(subtotal.subtract(discountAmount)));
    }

    private static BigDecimal money(BigDecimal value) {
        return value.setScale(MONEY_SCALE, RoundingMode.HALF_UP);
    }

    public record ItemInput(BigDecimal quantity, BigDecimal unitRate, BigDecimal minimumAmount, BigDecimal discountRate) {
    }

    public record CalculatedItem(BigDecimal subtotal, BigDecimal discountAmount, BigDecimal total) {
    }

    public record Calculation(List<CalculatedItem> items, BigDecimal subtotal, BigDecimal discountTotal, BigDecimal riskBufferRate, BigDecimal riskBufferAmount, BigDecimal taxRate, BigDecimal taxAmount, BigDecimal total) {
    }
}
