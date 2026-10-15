package com.freelanceops.backend.domain.workspace.policy;

/** 역할 변경 규칙 테스트에서 사용하는 예외다. */
public class RbacInvariantViolationException extends RuntimeException {

    private final String code;

    public RbacInvariantViolationException(String code, String message) {
        super(message);
        this.code = code;
    }

    public String code() {
        return code;
    }
}
