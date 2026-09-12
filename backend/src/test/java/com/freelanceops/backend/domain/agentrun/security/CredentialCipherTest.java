package com.freelanceops.backend.domain.agentrun.security;

import org.junit.jupiter.api.Test;
import java.util.Base64;
import static org.assertj.core.api.Assertions.*;

class CredentialCipherTest {
    private final CredentialCipher cipher = new CredentialCipher(Base64.getEncoder().encodeToString(new byte[32]));

    @Test void authenticatesOwnerBindingAndUsesFreshNonces() {
        String encrypted = cipher.encrypt("synthetic-provider-key", "connection:workspace:user:OPENAI");
        assertThat(encrypted).doesNotContain("synthetic-provider-key");
        assertThat(cipher.decrypt(encrypted, "connection:workspace:user:OPENAI")).isEqualTo("synthetic-provider-key");
        assertThat(cipher.encrypt("synthetic-provider-key", "connection:workspace:user:OPENAI")).isNotEqualTo(encrypted);
        assertThatThrownBy(() -> cipher.decrypt(encrypted, "connection:workspace:other:OPENAI")).isInstanceOf(IllegalStateException.class);
        byte[] bytes = Base64.getDecoder().decode(encrypted);
        bytes[bytes.length - 1] ^= 1;
        assertThatThrownBy(() -> cipher.decrypt(Base64.getEncoder().encodeToString(bytes), "connection:workspace:user:OPENAI")).isInstanceOf(IllegalStateException.class);
    }

    @Test void refusesMissingWrongAndMalformedEncryptionKeys() {
        assertThat(new CredentialCipher("").available()).isFalse();
        assertThatThrownBy(() -> new CredentialCipher(Base64.getEncoder().encodeToString(new byte[16]))).isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> cipher.decrypt("invalid", "owner")).hasMessage("Credential decryption unavailable");
    }
}
