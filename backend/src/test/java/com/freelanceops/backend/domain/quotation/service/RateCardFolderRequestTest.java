package com.freelanceops.backend.domain.quotation.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.freelanceops.backend.domain.quotation.dto.request.MoveRateCardRequest;

import org.junit.jupiter.api.Test;

import tools.jackson.core.JacksonException;
import tools.jackson.databind.json.JsonMapper;

import java.util.UUID;

class RateCardFolderRequestTest {
    private final JsonMapper mapper = JsonMapper.builder().build();

    @Test
    void anExplicitNullMovesToUnclassifiedButAnOmittedFieldCannotAccidentallyMoveARate() {
        assertThat(mapper.readValue("{\"folderId\":null}", MoveRateCardRequest.class).folderId()).isNull();
        assertThatThrownBy(() -> mapper.readValue("{}", MoveRateCardRequest.class)).isInstanceOf(JacksonException.class);
    }

    @Test
    void aFolderIdMustBeAValidUuid() {
        UUID id = UUID.randomUUID();
        assertThat(mapper.readValue("{\"folderId\":\"" + id + "\"}", MoveRateCardRequest.class).folderId()).isEqualTo(id);
        assertThatThrownBy(() -> mapper.readValue("{\"folderId\":\"invalid\"}", MoveRateCardRequest.class)).isInstanceOf(JacksonException.class);
    }
}
