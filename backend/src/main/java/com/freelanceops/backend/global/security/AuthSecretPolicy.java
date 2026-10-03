package com.freelanceops.backend.global.security;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

/** Requires a supplied key. The fingerprint only rejects a retired public key; it can never sign tokens. */
public final class AuthSecretPolicy {
    private static final String RETIRED_DEVELOPMENT_FINGERPRINT = "fe959bbd551ac6f61e733e893ef91dbbfaa2563b4b6f8ad27c5e94f745923c5f";
    private AuthSecretPolicy() { }

    public static byte[] require(String supplied) {
        if (supplied == null || supplied.isBlank() || supplied.getBytes(StandardCharsets.UTF_8).length < 32)
            throw new IllegalStateException("APP_AUTH_JWT_SECRET must be explicitly supplied with at least 32 random bytes");
        byte[] bytes = supplied.getBytes(StandardCharsets.UTF_8);
        try {
            String fingerprint = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
            if (isRetiredFingerprint(fingerprint))
                throw new IllegalStateException("The retired public development JWT key cannot be used");
        } catch (NoSuchAlgorithmException error) { throw new IllegalStateException("SHA-256 unavailable", error); }
        return bytes;
    }
    public static boolean isRetiredFingerprint(String fingerprint) {
        return RETIRED_DEVELOPMENT_FINGERPRINT.equals(fingerprint);
    }
}
