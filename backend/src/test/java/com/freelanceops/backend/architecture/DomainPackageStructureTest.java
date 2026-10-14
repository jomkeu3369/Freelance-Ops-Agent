package com.freelanceops.backend.architecture;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

class DomainPackageStructureTest {

    private static final Path DOMAIN_ROOT = Path.of(
        "src", "main", "java", "com", "freelanceops", "backend", "domain"
    );

    private static final Set<String> SUPPORTED_LAYERS = Set.of(
        "client", "controller", "dto", "entity", "model", "policy", "repository", "security", "service"
    );

    private static final Pattern PACKAGE_DECLARATION = Pattern.compile("(?m)^package\\s+([\\w.]+);");

    @Test
    void everyDomainUsesSupportedPackagesForItsSources() throws IOException {
        assertThat(DOMAIN_ROOT).isDirectory();

        try (var domains = Files.list(DOMAIN_ROOT)) {
            List<Path> domainDirectories = domains.filter(Files::isDirectory).sorted().toList();
            assertThat(domainDirectories).isNotEmpty();

            for (Path domain : domainDirectories) {
                try (var files = Files.walk(domain)) {
                    List<Path> sources = files.filter(Files::isRegularFile)
                        .filter(path -> path.toString().endsWith(".java"))
                        .filter(path -> !path.getFileName().toString().equals("package-info.java"))
                        .sorted().toList();
                    assertThat(sources).as("%s 도메인의 구현 소스", domain.getFileName()).isNotEmpty();

                    for (Path source : sources) {
                        Path relativePath = domain.relativize(source);
                        assertThat(relativePath.getNameCount()).as("%s 소스의 계층 경로", source).isGreaterThan(1);
                        assertThat(relativePath.getName(0).toString())
                            .as("%s 소스의 지원 계층", source).isIn(SUPPORTED_LAYERS);

                        String expectedPackage = "com.freelanceops.backend.domain."
                            + domain.getFileName() + "." + relativePath.getParent().toString()
                                .replace('\\', '.').replace('/', '.');
                        var declaration = PACKAGE_DECLARATION.matcher(Files.readString(source));
                        assertThat(declaration.find()).as("%s 소스의 패키지 선언", source).isTrue();
                        assertThat(declaration.group(1)).as("%s 소스의 패키지와 경로 일치", source)
                            .isEqualTo(expectedPackage);
                    }
                }
            }
        }
    }
}
