package com.freelanceops.backend.domain.quotation.dto.response;

import java.util.List;

/** A bounded keyset page; nextCursor is null when there are no older quotations. */
public record QuotationPageResponse(List<QuotationResponse> items, String nextCursor) {
}
