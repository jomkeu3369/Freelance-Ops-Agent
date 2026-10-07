package com.freelanceops.backend.domain.quotation.service;

import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

public final class QuotationAssumptionUnavailableException extends ResponseStatusException {
    public QuotationAssumptionUnavailableException() {
        super(HttpStatus.CONFLICT, "Standalone AI assumptions require durable budget admission");
    }
}
