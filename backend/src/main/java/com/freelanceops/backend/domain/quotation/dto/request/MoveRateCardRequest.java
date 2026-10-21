package com.freelanceops.backend.domain.quotation.dto.request;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.UUID;

public record MoveRateCardRequest(@JsonProperty(required = true) UUID folderId) {}
