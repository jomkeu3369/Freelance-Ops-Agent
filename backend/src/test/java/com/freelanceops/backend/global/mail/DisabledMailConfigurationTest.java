package com.freelanceops.backend.global.mail;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;
class DisabledMailConfigurationTest {
    @Test void shippedTransportCannotSendOrClaimAcceptance() {
        OperationalMailTransport transport = new DisabledMailConfiguration().disabledOperationalMailTransport();
        assertThat(transport.ready()).isFalse();
        assertThat(transport.send("synthetic", "nobody@example.invalid", "Synthetic test", "No network I/O"))
            .isEqualTo(OperationalMailTransport.Result.BLOCKED_TRANSPORT);
    }
}
