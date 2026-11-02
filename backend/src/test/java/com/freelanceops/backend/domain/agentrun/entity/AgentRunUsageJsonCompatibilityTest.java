package com.freelanceops.backend.domain.agentrun.entity;

import static org.assertj.core.api.Assertions.assertThat;

import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView.ProviderCallUsage;
import com.freelanceops.backend.domain.agentrun.model.Provider;
import com.freelanceops.backend.domain.agentrun.model.ProviderCallUsageSnapshot;

import org.hibernate.type.descriptor.java.ImmutableMutabilityPlan;
import org.hibernate.type.descriptor.java.JavaType;
import org.hibernate.type.descriptor.java.spi.JsonJavaType;
import org.hibernate.type.format.FormatMapper;
import org.hibernate.type.format.jackson.Jackson3JsonFormatMapper;
import org.hibernate.type.format.jackson.JacksonJsonFormatMapper;
import org.hibernate.type.spi.TypeConfiguration;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;

import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;

import java.lang.reflect.Type;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.stream.Stream;

class AgentRunUsageJsonCompatibilityTest {
    private static final JsonMapper JSON =
            JsonMapper.builder().enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS).build();
    private static final JavaType<List<ProviderCallUsageSnapshot>> STORED_TYPE =
            jsonType(fieldType(AgentRunUsageEntity.class, "providerCalls"));
    private static final JavaType<List<ProviderCallUsage>> LEGACY_TYPE =
            jsonType(fieldType(AgentRunUsageJsonCompatibilityTest.class, "legacyProviderCalls"));

    // The mapped field used this exact generic type before entity/DTO separation.
    private List<ProviderCallUsage> legacyProviderCalls;

    @ParameterizedTest(name = "{0}: existing JSONB remains readable")
    @MethodSource("jsonMappers")
    void existingRowsKeepTheirFieldsEnumsAndDecimalPrecision(String name, FormatMapper mapper)
            throws Exception {
        String original = legacyJson();
        List<ProviderCallUsageSnapshot> stored = mapper.fromString(original, STORED_TYPE, null);

        assertThat(stored).hasSize(2);
        assertThat(stored.getFirst().provider()).isEqualTo(Provider.GEMINI);
        assertThat(stored.getFirst().model()).isEqualTo("retired-model-v1");
        assertThat(stored.getFirst().costUsd()).isEqualTo(new BigDecimal("0.12345678"));
        assertThat(stored.getFirst().reservedCostUsd()).isEqualTo(new BigDecimal("1.23456789"));
        assertThat(stored.get(1).fundingSource()).isEqualTo("BYOK");
        assertThat(stored.get(1).usageKnown()).isFalse();
        String rewritten = mapper.toString(stored, STORED_TYPE, null);
        assertThat(JSON.readTree(rewritten)).isEqualTo(JSON.readTree(original));

        // A pre-refactor reader must also accept data written using the new mapped type.
        List<ProviderCallUsage> oldReader = mapper.fromString(rewritten, LEGACY_TYPE, null);
        assertThat(oldReader)
                .isEqualTo(stored.stream().map(ProviderCallUsage::fromSnapshot).toList());
    }

    @ParameterizedTest(name = "{0}: HTTP and JSONB remain compatible")
    @MethodSource("jsonMappers")
    void apiAndPersistenceConversionsPreserveTheLegacyJson(String name, FormatMapper mapper)
            throws Exception {
        List<ProviderCallUsage> apiCalls = mapper.fromString(legacyJson(), LEGACY_TYPE, null);
        var snapshots = apiCalls.stream().map(ProviderCallUsage::toSnapshot).toList();
        String stored = mapper.toString(snapshots, STORED_TYPE, null);
        assertThat(JSON.readTree(stored)).isEqualTo(JSON.readTree(legacyJson()));
        assertThat(
                        JSON.readTree(
                                JSON.writeValueAsString(
                                        snapshots.stream()
                                                .map(ProviderCallUsage::fromSnapshot)
                                                .toList())))
                .isEqualTo(JSON.readTree(legacyJson()));
    }

    @ParameterizedTest(name = "{0}: pre-ledger rows keep their empty default")
    @MethodSource("jsonMappers")
    void preLedgerEmptyArraysRemainReadable(String name, FormatMapper mapper) {
        List<ProviderCallUsageSnapshot> stored = mapper.fromString("[]", STORED_TYPE, null);
        assertThat(stored).isEmpty();
        assertThat(mapper.toString(stored, STORED_TYPE, null)).isEqualTo("[]");
    }

    private static Stream<Arguments> jsonMappers() {
        return Stream.of(
                Arguments.of("Jackson 2", new JacksonJsonFormatMapper()),
                Arguments.of("Jackson 3", new Jackson3JsonFormatMapper()));
    }

    private static String legacyJson() throws Exception {
        try (var input =
                AgentRunUsageJsonCompatibilityTest.class.getResourceAsStream(
                        "/compatibility/agent-run-provider-calls.json")) {
            if (input == null) throw new IllegalStateException("Missing compatibility fixture");
            return new String(input.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    private static Type fieldType(Class<?> owner, String name) {
        try {
            return owner.getDeclaredField(name).getGenericType();
        } catch (NoSuchFieldException error) {
            throw new ExceptionInInitializerError(error);
        }
    }

    private static <T> JavaType<T> jsonType(Type type) {
        return new JsonJavaType<>(
                type, ImmutableMutabilityPlan.instance(), new TypeConfiguration());
    }
}
