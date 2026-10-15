package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.model.Provider;

import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** 과거 기록에 있는 제공사 이름만으로 새 실행을 허용하지 않는다. */
public final class ProviderPolicy {
    private ProviderPolicy() {}

    public static void requireSupported(Provider provider) {
        if (provider == null || !provider.supported()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Unsupported AI provider");
        }
    }
}
