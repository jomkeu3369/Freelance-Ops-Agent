package com.freelanceops.backend.system;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/meta")
public class ServiceMetadataController {

    @GetMapping
    ServiceMetadata getServiceMetadata() {
        return ServiceMetadata.current();
    }
}

