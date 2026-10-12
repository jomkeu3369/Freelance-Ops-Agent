package com.freelanceops.backend.domain.quotation.service;

import com.freelanceops.backend.domain.quotation.entity.QuotationEntity;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.Base64;
import java.util.UUID;

/** An ordering boundary, never an authorization token. Every query retains both scope predicates. */
record QuotationCursor(Instant createdAt, UUID id) {
    static QuotationCursor decode(String value) {
        if (value == null) return null;
        try {
            if (value.isEmpty() || value.length() > 160) throw new IllegalArgumentException();
            String decoded = new String(Base64.getUrlDecoder().decode(value), StandardCharsets.UTF_8);
            String[] parts = decoded.split("\\|", -1);
            if (parts.length != 2) throw new IllegalArgumentException();
            Instant createdAt = Instant.parse(parts[0]);
            // PostgreSQL timestamps and application quotation dates must have ordinary calendar years.
            if (createdAt.isBefore(Instant.parse("0001-01-01T00:00:00Z"))
                || !createdAt.isBefore(Instant.parse("+10000-01-01T00:00:00Z"))) throw new IllegalArgumentException();
            UUID id = UUID.fromString(parts[1]);
            if (!id.toString().equals(parts[1])) throw new IllegalArgumentException();
            return new QuotationCursor(createdAt, id);
        } catch (IllegalArgumentException | DateTimeParseException error) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid quotation cursor");
        }
    }

    static String encode(QuotationEntity quotation) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(
            (quotation.createdAt() + "|" + quotation.id()).getBytes(StandardCharsets.UTF_8));
    }
}
