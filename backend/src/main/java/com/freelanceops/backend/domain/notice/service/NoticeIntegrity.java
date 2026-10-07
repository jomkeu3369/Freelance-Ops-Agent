package com.freelanceops.backend.domain.notice.service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;

public final class NoticeIntegrity {
    private NoticeIntegrity() { }
    /** Length-prefixed fields prevent delimiter ambiguity. Input ordering is part of the contract. */
    public static String hash(List<String> fields) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            for (String field : fields) {
                byte[] bytes = field.getBytes(StandardCharsets.UTF_8);
                digest.update((bytes.length + ":").getBytes(StandardCharsets.US_ASCII));
                digest.update(bytes);
            }
            return HexFormat.of().formatHex(digest.digest());
        } catch (NoSuchAlgorithmException error) { throw new IllegalStateException("SHA-256 unavailable", error); }
    }
}
