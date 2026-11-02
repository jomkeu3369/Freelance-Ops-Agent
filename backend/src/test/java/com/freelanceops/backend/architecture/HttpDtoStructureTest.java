package com.freelanceops.backend.architecture;

import static org.assertj.core.api.Assertions.assertThat;

import com.freelanceops.backend.architecture.fixtures.dto.ResponseWithServicePayload;
import com.freelanceops.backend.global.health.ServiceMetadata;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;

import org.junit.jupiter.api.Test;
import org.springframework.core.annotation.AnnotatedElementUtils;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;

import java.lang.reflect.GenericArrayType;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.lang.reflect.ParameterizedType;
import java.lang.reflect.Type;
import java.lang.reflect.TypeVariable;
import java.lang.reflect.WildcardType;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** HTTP 계약을 이름 접미사가 아니라 실제 바인딩·직렬화 타입으로 검사한다. */
class HttpDtoStructureTest {
    private static final String PROJECT_PACKAGE = "com.freelanceops.backend.";
    private static final List<Class<?>> CONTROLLERS =
            new ClassFileImporter()
                            .withImportOption(new ImportOption.DoNotIncludeTests())
                            .importPackages(PROJECT_PACKAGE)
                            .stream()
                            .<Class<?>>map(type -> type.reflect())
                            .filter(
                                    type ->
                                            AnnotatedElementUtils.hasAnnotation(
                                                            type, Controller.class)
                                                    || AnnotatedElementUtils.hasAnnotation(
                                                            type, ControllerAdvice.class))
                            .toList();

    @Test
    void requestBodiesUseDtosIncludingTheirNestedPayloads() {
        List<String> violations = new ArrayList<>();
        CONTROLLERS.forEach(type -> checkRequestBodies(type, violations));
        assertThat(violations).isEmpty();
    }

    @Test
    void endpointAndExceptionResponsesUseDtosIncludingTheirNestedPayloads() {
        List<String> violations = new ArrayList<>();
        CONTROLLERS.forEach(type -> checkResponses(type, violations));
        assertThat(violations).isEmpty();
    }

    @Test
    void detectsRequestBodiesWithoutARequestSuffix() {
        List<String> violations = new ArrayList<>();
        checkRequestBodies(MisplacedPayloadController.class, violations);
        assertThat(violations)
                .singleElement()
                .asString()
                .contains("MisplacedPayload", "request body");
    }

    @Test
    void detectsPayloadsInsideGenericResponseContainers() {
        List<String> violations = new ArrayList<>();
        checkResponses(MisplacedPayloadController.class, violations);
        assertThat(violations).singleElement().asString().contains("MisplacedPayload", "response");
    }

    @Test
    void detectsServiceTypesHiddenInsideDtoComponents() {
        List<String> violations = new ArrayList<>();
        checkResponses(NestedServicePayloadController.class, violations);
        assertThat(violations)
                .singleElement()
                .asString()
                .contains("WorkspaceProvisioningResult", ".result");
    }

    @Test
    void detectsMisplacedExceptionResponseTypes() {
        List<String> violations = new ArrayList<>();
        checkResponses(MisplacedExceptionHandler.class, violations);
        assertThat(violations).singleElement().asString().contains("MisplacedPayload", "response");
    }

    private static void checkRequestBodies(Class<?> controller, List<String> violations) {
        for (Method method : controller.getDeclaredMethods()) {
            if (!isEndpoint(method)) continue;
            for (var parameter : method.getParameters()) {
                if (parameter.isAnnotationPresent(RequestBody.class)) {
                    checkPayload(
                            parameter.getParameterizedType(),
                            method.toGenericString() + " request body",
                            new HashSet<>(),
                            violations);
                }
            }
        }
    }

    private static void checkResponses(Class<?> controller, List<String> violations) {
        for (Method method : controller.getDeclaredMethods()) {
            if (isEndpoint(method) || method.isAnnotationPresent(ExceptionHandler.class)) {
                checkPayload(
                        method.getGenericReturnType(),
                        method.toGenericString() + " response",
                        new HashSet<>(),
                        violations);
            }
        }
    }

    private static boolean isEndpoint(Method method) {
        return AnnotatedElementUtils.hasAnnotation(method, RequestMapping.class);
    }

    private static void checkPayload(
            Type type, String context, Set<Type> visited, List<String> violations) {
        if (!visited.add(type)) return;
        if (type instanceof ParameterizedType parameterized) {
            checkPayload(parameterized.getRawType(), context, visited, violations);
            for (Type argument : parameterized.getActualTypeArguments()) {
                checkPayload(argument, context, visited, violations);
            }
        } else if (type instanceof GenericArrayType array) {
            checkPayload(array.getGenericComponentType(), context, visited, violations);
        } else if (type instanceof TypeVariable<?> variable) {
            for (Type bound : variable.getBounds()) {
                checkPayload(bound, context, visited, violations);
            }
        } else if (type instanceof WildcardType wildcard) {
            for (Type bound : wildcard.getUpperBounds()) {
                checkPayload(bound, context, visited, violations);
            }
            for (Type bound : wildcard.getLowerBounds()) {
                checkPayload(bound, context, visited, violations);
            }
        } else if (type instanceof Class<?> payload) {
            if (payload.isArray()) {
                checkPayload(payload.getComponentType(), context, visited, violations);
                return;
            }
            // JDK/framework wrappers and domain enums are legitimate wire values.
            if (!payload.getPackageName().startsWith(PROJECT_PACKAGE) || payload.isEnum()) return;
            String packageName = payload.getPackageName();
            // This existing operational response lives next to its health endpoint.
            if (!packageName.contains(".dto.")
                    && !packageName.endsWith(".dto")
                    && payload != ServiceMetadata.class) {
                violations.add(
                        context + " exposes " + payload.getName() + " outside a DTO package");
                return;
            }
            if (payload.isRecord()) {
                for (var component : payload.getRecordComponents()) {
                    checkPayload(
                            component.getGenericType(),
                            context + "." + component.getName(),
                            visited,
                            violations);
                }
            } else {
                for (var field : payload.getDeclaredFields()) {
                    if (!Modifier.isStatic(field.getModifiers()) && !field.isSynthetic()) {
                        checkPayload(
                                field.getGenericType(),
                                context + "." + field.getName(),
                                visited,
                                violations);
                    }
                }
            }
        }
    }

    private record MisplacedPayload(String value) {}

    private static class MisplacedPayloadController {
        @PostMapping
        void save(@RequestBody MisplacedPayload input) {}

        @GetMapping
        ResponseEntity<List<MisplacedPayload>> list() {
            throw new UnsupportedOperationException("Architecture test fixture only");
        }
    }

    private static class NestedServicePayloadController {
        @GetMapping
        ResponseWithServicePayload get() {
            throw new UnsupportedOperationException("Architecture test fixture only");
        }
    }

    private static class MisplacedExceptionHandler {
        @ExceptionHandler(RuntimeException.class)
        MisplacedPayload rejected(RuntimeException error) {
            throw new UnsupportedOperationException("Architecture test fixture only");
        }
    }
}
