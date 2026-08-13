package com.freelanceops.backend.domain.proposal.entity;

import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ProposalShareEntityTest {

    @Test
    void enforcesExpiryAndRevocation() {
        Instant now = Instant.parse("2026-08-14T00:00:00Z");
        ProposalShareEntity share = new ProposalShareEntity(
            UUID.randomUUID(),
            UUID.randomUUID(),
            UUID.randomUUID(),
            "a".repeat(64),
            now.plusSeconds(60),
            UUID.randomUUID(),
            now
        );

        assertThat(share.availableAt(now.plusSeconds(1))).isTrue();
        assertThat(share.availableAt(now.plusSeconds(60))).isFalse();
        share.revoke(now.plusSeconds(2));
        assertThat(share.availableAt(now.plusSeconds(3))).isFalse();
        assertThat(share.revokedAt()).isEqualTo(now.plusSeconds(2));
    }

    @Test
    void rejectsRawOrMalformedTokenMaterial() {
        Instant now = Instant.now();

        assertThatThrownBy(() -> new ProposalShareEntity(
            UUID.randomUUID(),
            UUID.randomUUID(),
            UUID.randomUUID(),
            "raw-share-token",
            now.plusSeconds(60),
            UUID.randomUUID(),
            now
        )).isInstanceOf(IllegalArgumentException.class);
    }
}
