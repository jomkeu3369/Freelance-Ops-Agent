package com.freelanceops.backend.global.health;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class ServiceMetadataTest {

    @Test
    void exposesStableServiceIdentity() {
        ServiceMetadata metadata = ServiceMetadata.current();

        assertThat(metadata.service()).isEqualTo("backend");
        assertThat(metadata.version()).isEqualTo("0.1.0");
        assertThat(metadata.status()).isEqualTo("UP");
    }
}



