package com.freelanceops.backend.global.config;

import static org.assertj.core.api.Assertions.assertThat;

import com.freelanceops.backend.domain.agentrun.dto.request.SaveAIConnectionRequest;
import com.freelanceops.backend.domain.identity.dto.response.AdminMemberAuditResponse;
import com.freelanceops.backend.domain.identity.dto.response.AdminMemberLoginResponse;
import com.freelanceops.backend.domain.identity.dto.response.AdminMemberResponse;
import com.freelanceops.backend.domain.identity.dto.response.Page;
import com.freelanceops.backend.domain.quotation.dto.response.QuotationPreviewResponse;

import io.swagger.v3.core.converter.AnnotatedType;
import io.swagger.v3.core.converter.ModelConverters;
import io.swagger.v3.core.converter.ResolvedSchema;
import io.swagger.v3.oas.models.media.Schema;

import org.junit.jupiter.api.Test;

import java.lang.reflect.Type;
import java.util.Map;

class DtoOpenApiCompatibilityTest {
    @Test
    void keepsExistingRequestSchemaNameAndValidationMetadata() {
        var resolved = resolve(SaveAIConnectionRequest.class);
        assertThat(resolved.schema.get$ref()).isEqualTo("#/components/schemas/SaveConnection");
        Schema<?> schema = resolved.referencedSchemas.get("SaveConnection");
        assertThat(schema.getProperties()).containsOnlyKeys("model", "apiKey");
        assertThat(schema.getProperties().get("model").getMaxLength()).isEqualTo(100);
        assertThat(schema.getProperties().get("apiKey").getMinLength()).isEqualTo(16);
        assertThat(schema.getProperties().get("apiKey").getMaxLength()).isEqualTo(512);
    }

    @Test
    void keepsDistinctAdminPageNamesAndItemReferences() throws Exception {
        for (var entry :
                Map.of("members", "Member", "logins", "Login", "audits", "Audit").entrySet()) {
            var resolved =
                    resolve(AdminPages.class.getDeclaredField(entry.getKey()).getGenericType());
            String item = entry.getValue();
            assertThat(resolved.schema.get$ref()).isEqualTo("#/components/schemas/Page" + item);
            Schema<?> page = resolved.referencedSchemas.get("Page" + item);
            assertThat(page.getProperties())
                    .containsOnlyKeys("items", "total", "page", "size", "recordingStartedAt");
            assertThat(page.getProperties().get("items").getItems().get$ref())
                    .isEqualTo("#/components/schemas/" + item);
        }
    }

    @Test
    void keepsQuotationPreviewAndItemSchemaNames() {
        var resolved = resolve(QuotationPreviewResponse.class);
        assertThat(resolved.schema.get$ref()).isEqualTo("#/components/schemas/Calculation");
        Schema<?> calculation = resolved.referencedSchemas.get("Calculation");
        assertThat(calculation.getProperties())
                .containsOnlyKeys(
                        "items",
                        "subtotal",
                        "discountTotal",
                        "riskBufferRate",
                        "riskBufferAmount",
                        "taxRate",
                        "taxAmount",
                        "total");
        assertThat(calculation.getProperties().get("items").getItems().get$ref())
                .isEqualTo("#/components/schemas/CalculatedItem");
        assertThat(resolved.referencedSchemas.get("CalculatedItem").getProperties())
                .containsOnlyKeys("subtotal", "discountAmount", "total");
    }

    private static ResolvedSchema resolve(Type type) {
        return new ModelConverters()
                .resolveAsResolvedSchema(new AnnotatedType(type).resolveAsRef(true));
    }

    private record AdminPages(
            Page<AdminMemberResponse> members,
            Page<AdminMemberLoginResponse> logins,
            Page<AdminMemberAuditResponse> audits) {}
}
