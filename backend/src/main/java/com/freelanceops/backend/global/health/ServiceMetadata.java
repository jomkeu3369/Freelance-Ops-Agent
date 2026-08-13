package com.freelanceops.backend.global.health;

public record ServiceMetadata(String service, String version, String status) {

    public static ServiceMetadata current() {
        return new ServiceMetadata("backend", "0.1.0", "UP");
    }
}



