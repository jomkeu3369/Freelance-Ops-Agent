package com.freelanceops.backend.global.mail;

import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class DisabledMailConfiguration {
    @Bean
    @ConditionalOnMissingBean(OperationalMailTransport.class)
    OperationalMailTransport disabledOperationalMailTransport() {
        return new OperationalMailTransport() {
            public boolean ready() { return false; }
            public Result send(String key, String recipient, String subject, String body) { return Result.BLOCKED_TRANSPORT; }
        };
    }
}
