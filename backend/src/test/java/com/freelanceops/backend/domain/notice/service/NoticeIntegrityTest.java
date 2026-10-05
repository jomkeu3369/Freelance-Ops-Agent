package com.freelanceops.backend.domain.notice.service;
import org.junit.jupiter.api.Test;
import java.util.List;
import static org.assertj.core.api.Assertions.assertThat;
class NoticeIntegrityTest {
    @Test void hashesAreStableOrderSensitiveAndUnambiguous() {
        assertThat(NoticeIntegrity.hash(List.of("a", "bc"))).hasSize(64).isEqualTo(NoticeIntegrity.hash(List.of("a", "bc")));
        assertThat(NoticeIntegrity.hash(List.of("a", "bc"))).isNotEqualTo(NoticeIntegrity.hash(List.of("ab", "c")));
        assertThat(NoticeIntegrity.hash(List.of("user1", "user2"))).isNotEqualTo(NoticeIntegrity.hash(List.of("user2", "user1")));
        assertThat(NoticeIntegrity.hash(List.of("서비스", "v1"))).isNotEqualTo(NoticeIntegrity.hash(List.of("서비스", "v2")));
    }
}
