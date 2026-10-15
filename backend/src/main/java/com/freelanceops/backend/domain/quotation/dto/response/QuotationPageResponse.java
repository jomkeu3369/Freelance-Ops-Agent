package com.freelanceops.backend.domain.quotation.dto.response;

import java.util.List;

/** 커서 기반 견적 목록이다. 더 오래된 견적이 없으면 nextCursor는 null이다. */
public record QuotationPageResponse(List<QuotationResponse> items, String nextCursor) {}
