package com.freelanceops.backend.domain.agentrun.dto;

/** Untrusted data, never an instruction or an authority grant. No original binary is retained. */
public record AttachmentText(String name, String mediaType, long size, String sha256, String status,
                             String text, String notice, String encoding, String delimiter, int units) {
    public AttachmentText {
        if (name == null || name.isEmpty() || name.length() > 180 || mediaType == null || mediaType.length() > 100
            || text == null || text.codePointCount(0, text.length()) > 40000
            || encoding != null && encoding.length() > 10 || delimiter != null && delimiter.length() > 4
            || size < 1 || size > 2097152 || sha256 == null || !sha256.matches("[0-9a-f]{64}")
            || !java.util.Set.of("COMPLETE", "PARTIAL", "UNSUPPORTED").contains(status)
            || notice == null || notice.length() > 1000 || units < 1 || units > 5000) {
            throw new IllegalArgumentException("Invalid attachment extraction result");
        }
    }
}
