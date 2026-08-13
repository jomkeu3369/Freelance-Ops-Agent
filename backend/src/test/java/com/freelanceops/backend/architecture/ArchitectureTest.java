package com.freelanceops.backend.architecture;

import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchRule;
import com.tngtech.archunit.core.importer.ImportOption;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;
import static com.tngtech.archunit.library.dependencies.SlicesRuleDefinition.slices;

@AnalyzeClasses(
    packages = "com.freelanceops.backend",
    importOptions = ImportOption.DoNotIncludeTests.class
)
class ArchitectureTest {

    @ArchTest
    static final ArchRule controllers_must_not_access_repositories = noClasses()
        .that().resideInAPackage("..controller..")
        .should().dependOnClassesThat().resideInAPackage("..repository..");

    @ArchTest
    static final ArchRule services_must_not_access_controllers = noClasses()
        .that().resideInAPackage("..service..")
        .should().dependOnClassesThat().resideInAPackage("..controller..");

    @ArchTest
    static final ArchRule repositories_must_not_access_services_or_controllers = noClasses()
        .that().resideInAPackage("..repository..")
        .should().dependOnClassesThat().resideInAnyPackage("..service..", "..controller..");

    @ArchTest
    static final ArchRule entities_must_not_access_web_or_service_layers = noClasses()
        .that().resideInAPackage("..entity..")
        .should().dependOnClassesThat().resideInAnyPackage("..controller..", "..service..");

    @ArchTest
    static final ArchRule controllers_must_be_annotated = classes()
        .that().resideInAPackage("..controller..")
        .and().haveSimpleNameEndingWith("Controller")
        .should().beAnnotatedWith(org.springframework.web.bind.annotation.RestController.class)
        .orShould().beAnnotatedWith(org.springframework.stereotype.Controller.class);

    @ArchTest
    static final ArchRule requests_must_reside_in_request_packages = classes()
        .that().resideInAPackage("..dto..")
        .and().haveSimpleNameEndingWith("Request")
        .should().resideInAPackage("..dto.request..");

    @ArchTest
    static final ArchRule responses_must_reside_in_response_packages = classes()
        .that().resideInAPackage("..dto..")
        .and().haveSimpleNameEndingWith("Response")
        .should().resideInAPackage("..dto.response..");

    @ArchTest
    static final ArchRule domains_must_not_have_cycles = slices()
        .matching("com.freelanceops.backend.domain.(*)..")
        .should().beFreeOfCycles();
}
