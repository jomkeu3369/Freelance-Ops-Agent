package com.freelanceops.backend.domain.agentrun.dto;

import java.util.List;
import java.util.Set;

/** Untrusted data, never an instruction or an authority grant. No original binary is retained. */
public record AttachmentText(String name, String mediaType, long size, String sha256, String status,
                             String text, String notice, String encoding, String delimiter, int units,
                             String ocrLanguage, String ocrLayout, List<Coverage> coverage) {
    public record Coverage(int index, String kind, String nativeStatus, String rasterStatus,
                           boolean ocrAttempted, boolean ocrCompleted, String ocrStatus, String reason) {
        public Coverage {
            if (index < 1 || index > 60 || kind == null || !Set.of("PAGE", "FRAME").contains(kind)
                || nativeStatus == null || !Set.of("TEXT", "EMPTY", "FAILED", "NOT_APPLICABLE").contains(nativeStatus)
                || rasterStatus == null || !Set.of("NONE", "SMALL", "LARGE", "UNKNOWN", "NOT_APPLICABLE").contains(rasterStatus)
                || ocrStatus == null || !Set.of("READ", "EMPTY", "FAILED", "SKIPPED").contains(ocrStatus)
                || reason == null || !Set.of("TEXT_ONLY", "SMALL_RASTER", "SAMPLED_OUT", "BUDGET_EXHAUSTED",
                    "TOOL_UNAVAILABLE", "LANGUAGE_UNAVAILABLE", "TOOL_FAILED", "EMPTY_RESULT", "TEXT_FOUND", "DUPLICATE_ONLY").contains(reason)
                || ocrAttempted != !"SKIPPED".equals(ocrStatus)
                || ocrCompleted != Set.of("READ", "EMPTY").contains(ocrStatus))
                throw new IllegalArgumentException("Invalid attachment coverage");
        }
    }

    public AttachmentText(String name, String mediaType, long size, String sha256, String status,
                          String text, String notice, String encoding, String delimiter, int units) {
        this(name, mediaType, size, sha256, status, text, notice, encoding, delimiter, units, "mixed", "general", List.of());
    }

    public AttachmentText {
        // Old staging/START JSON has no OCR options or structured coverage.
        ocrLanguage = ocrLanguage == null ? "mixed" : ocrLanguage;
        ocrLayout = ocrLayout == null ? "general" : ocrLayout;
        coverage = coverage == null ? List.of() : List.copyOf(coverage);
        if (name == null || name.isEmpty() || name.length() > 180 || mediaType == null || mediaType.length() > 100
            || text == null || text.codePointCount(0, text.length()) > 40000
            || encoding != null && encoding.length() > 10 || delimiter != null && delimiter.length() > 4
            || size < 1 || size > 2097152 || sha256 == null || !sha256.matches("[0-9a-f]{64}")
            || !java.util.Set.of("COMPLETE", "PARTIAL", "UNSUPPORTED").contains(status)
            || notice == null || notice.length() > 1000 || units < 1 || units > 5000
            || !Set.of("mixed", "ko", "en").contains(ocrLanguage) || !Set.of("general", "singleblock").contains(ocrLayout)
            || coverage.size() > 60 || !coverage.isEmpty() && coverage.size() != units) {
            throw new IllegalArgumentException("Invalid attachment extraction result");
        }
        for (int i = 0; i < coverage.size(); i++)
            if (coverage.get(i).index() != i + 1) throw new IllegalArgumentException("Invalid attachment coverage order");
    }
}
