package com.freelanceops.backend.domain.agentrun.security;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Base64;

@Component
public class CredentialCipher {
    private final byte[] key;
    private final SecureRandom random = new SecureRandom();

    public CredentialCipher(@Value("${APP_BYOK_ENCRYPTION_KEY:}") String encodedKey) {
        key = encodedKey.isBlank() ? new byte[0] : Base64.getDecoder().decode(encodedKey);
        if (key.length != 0 && key.length != 32) throw new IllegalStateException("BYOK encryption key must be 32 bytes");
    }

    public boolean available() { return key.length == 32; }

    public String encrypt(String plaintext, String binding) {
        try {
            byte[] nonce = new byte[12];
            random.nextBytes(nonce);
            byte[] encrypted = cipher(Cipher.ENCRYPT_MODE, nonce, binding).doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
            return Base64.getEncoder().encodeToString(ByteBuffer.allocate(nonce.length + encrypted.length).put(nonce).put(encrypted).array());
        } catch (Exception error) { throw new IllegalStateException("Credential encryption unavailable"); }
    }

    public String decrypt(String ciphertext, String binding) {
        try {
            ByteBuffer data = ByteBuffer.wrap(Base64.getDecoder().decode(ciphertext));
            byte[] nonce = new byte[12];
            data.get(nonce);
            byte[] encrypted = new byte[data.remaining()];
            data.get(encrypted);
            return new String(cipher(Cipher.DECRYPT_MODE, nonce, binding).doFinal(encrypted), StandardCharsets.UTF_8);
        } catch (Exception error) { throw new IllegalStateException("Credential decryption unavailable"); }
    }

    private Cipher cipher(int mode, byte[] nonce, String binding) throws Exception {
        if (!available()) throw new IllegalStateException("BYOK unavailable");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(mode, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, nonce));
        cipher.updateAAD(binding.getBytes(StandardCharsets.UTF_8));
        return cipher;
    }
}
