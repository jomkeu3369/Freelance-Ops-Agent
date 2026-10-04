package com.freelanceops.backend.global.mail;

/** No provider is shipped. An adapter must honour the stable idempotency key and never log message bodies. */
public interface OperationalMailTransport {
    boolean ready();
    Result send(String idempotencyKey, String recipient, String subject, String plainText);
    enum Result { ACCEPTED, BLOCKED_TRANSPORT, RETRYABLE_FAILED, PERMANENT_FAILED, UNKNOWN, BOUNCED }
}
