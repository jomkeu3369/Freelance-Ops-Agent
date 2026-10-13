package com.freelanceops.backend.domain.specification.service;

import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;

/** Lossless, deterministic projection. It cannot invent facts or rewrite confirmed text. */
public final class SpecificationText {
    private static final int CHUNK_SIZE = 18000;
    private SpecificationText() {}

    public static void validate(String title, String text) {
        if (title == null || title.isBlank() || title.length() > 300 || text == null || text.isBlank() || text.length() > 100000)
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_CONTENT, "specification title or content is invalid");
        validateUnicode(title);
        validateUnicode(text);
        if (lineBreakCount(text) > 4000)
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_CONTENT, "명세는 줄바꿈 4,000개 이하로 나누어 작성해 주세요. 입력은 변경되지 않았습니다.");
    }

    private static int lineBreakCount(String text) {
        int count = 0;
        for (int offset = 0; offset < text.length(); offset++) {
            char unit = text.charAt(offset);
            if (unit == '\r') {
                count++;
                // A Windows CRLF is one logical break. Keep both source characters.
                if (offset + 1 < text.length() && text.charAt(offset + 1) == '\n') offset++;
            } else if (unit == '\n' || unit == 0x2028 || unit == 0x2029) count++;
        }
        return count;
    }

    private static void validateUnicode(String text) {
        for (int offset = 0; offset < text.length();) {
            char unit = text.charAt(offset);
            if (Character.isSurrogate(unit) && (!Character.isHighSurrogate(unit) || offset + 1 == text.length() || !Character.isLowSurrogate(text.charAt(offset + 1))))
                throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_CONTENT, "specification contains an incomplete Unicode character");
            int codepoint = text.codePointAt(offset);
            if ((Character.isISOControl(codepoint) && codepoint != '\n' && codepoint != '\r' && codepoint != '\t')
                || (codepoint >= 0x202A && codepoint <= 0x202E) || (codepoint >= 0x2066 && codepoint <= 0x2069))
                throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_CONTENT, "specification contains unsupported control characters");
            offset += Character.charCount(codepoint);
        }
    }

    public static String hash(String text) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8))); }
        catch (NoSuchAlgorithmException error) { throw new IllegalStateException("SHA-256 is unavailable", error); }
    }

    public static List<Chunk> chunks(String content) {
        List<Chunk> result = new ArrayList<>();
        int start = 0;
        while (start < content.length()) {
            int end = Math.min(start + CHUNK_SIZE, content.length());
            if (end < content.length() && Character.isHighSurrogate(content.charAt(end - 1))) end--;
            result.add(new Chunk(result.size(), start, end, content.substring(start, end)));
            start = end;
        }
        if (!result.stream().map(Chunk::content).collect(java.util.stream.Collectors.joining()).equals(content))
            throw new IllegalStateException("specification projection must preserve the confirmed content");
        return List.copyOf(result);
    }

    public static String downloadName(String title, int revision) {
        String safe = title.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").strip().replaceAll("[. ]+$", "");
        int end = Math.min(safe.length(), 80);
        if (end > 0 && Character.isHighSurrogate(safe.charAt(end - 1))) end--;
        safe = safe.substring(0, end);
        if (safe.isBlank()) safe = "명세서";
        return safe + "-v" + revision + ".pdf";
    }

    public record Chunk(int index, int startOffset, int endOffset, String content) {}
}
