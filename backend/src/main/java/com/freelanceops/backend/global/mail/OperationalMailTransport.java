package com.freelanceops.backend.global.mail;

/** 메일 제공사는 별도로 연결한다. 어댑터는 중복 방지 키를 준수하고 본문을 기록하지 않아야 한다. */
public interface OperationalMailTransport {
    boolean ready();

    Result send(String idempotencyKey, String recipient, String subject, String plainText);

    enum Result {
        ACCEPTED,
        BLOCKED_TRANSPORT,
        RETRYABLE_FAILED,
        PERMANENT_FAILED,
        UNKNOWN,
        BOUNCED
    }
}
