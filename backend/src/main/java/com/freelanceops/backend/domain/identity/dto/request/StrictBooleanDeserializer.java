package com.freelanceops.backend.domain.identity.dto.request;

import tools.jackson.core.JsonParser;
import tools.jackson.core.JsonToken;
import tools.jackson.databind.DeserializationContext;
import tools.jackson.databind.deser.std.StdScalarDeserializer;

/** 동의 여부에는 문자열이나 숫자를 변환하지 않고 boolean 값만 허용한다. */
public class StrictBooleanDeserializer extends StdScalarDeserializer<Boolean> {

    public StrictBooleanDeserializer() {
        super(Boolean.class);
    }

    @Override
    public Boolean deserialize(JsonParser parser, DeserializationContext context) {
        if (parser.hasToken(JsonToken.VALUE_TRUE)) {
            return Boolean.TRUE;
        }
        if (parser.hasToken(JsonToken.VALUE_FALSE)) {
            return Boolean.FALSE;
        }
        return (Boolean) context.handleUnexpectedToken(Boolean.class, parser);
    }
}
