package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.model.Provider;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** Provider names in historical records do not authorize new provider use. */
public final class ProviderPolicy {
    private ProviderPolicy() {}

    public static void requireSupported(Provider provider) {
        if (provider == null || !provider.supported()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Unsupported AI provider");
        }
    }
}
