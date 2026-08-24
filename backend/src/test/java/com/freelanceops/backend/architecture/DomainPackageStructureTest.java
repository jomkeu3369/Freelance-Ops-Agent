package com.freelanceops.backend.architecture;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class DomainPackageStructureTest {

    private static final Path DOMAIN_ROOT = Path.of(
        "src", "main", "java", "com", "freelanceops", "backend", "domain"
    );

    private static final List<Path> REQUIRED_PACKAGES = List.of(
        Path.of("client"),
        Path.of("controller"),
        Path.of("dto", "request"),
        Path.of("dto", "response"),
        Path.of("entity"),
        Path.of("model"),
        Path.of("repository"),
        Path.of("security"),
        Path.of("service")
    );

    @Test
    void everyDomainUsesTheAgentRunPackageStructure() throws IOException {
        assertThat(DOMAIN_ROOT).isDirectory();

        try (var domains = Files.list(DOMAIN_ROOT)) {
            List<Path> domainDirectories = domains.filter(Files::isDirectory).sorted().toList();
            assertThat(domainDirectories).isNotEmpty();

            for (Path domain : domainDirectories) {
                for (Path requiredPackage : REQUIRED_PACKAGES) {
                    assertThat(domain.resolve(requiredPackage))
                        .as("%s domain must contain %s", domain.getFileName(), requiredPackage)
                        .isDirectory();
                }
            }
        }
    }
}
