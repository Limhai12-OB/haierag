package com.haierag.common;

import java.util.Collections;
import java.util.Map;

import org.springframework.stereotype.Component;

import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;

/** Small helper for jsonb columns. */
@Component
public class Json {

    private static final TypeReference<Map<String, Object>> MAP = new TypeReference<>() {
    };

    private final JsonMapper mapper;

    public Json(JsonMapper mapper) {
        this.mapper = mapper;
    }

    public JsonMapper mapper() {
        return mapper;
    }

    public Map<String, Object> toMap(String json) {
        if (json == null || json.isBlank()) {
            return Collections.emptyMap();
        }
        try {
            return mapper.readValue(json, MAP);
        } catch (RuntimeException e) {
            return Collections.emptyMap();
        }
    }

    public String write(Object value) {
        return mapper.writeValueAsString(value == null ? Map.of() : value);
    }
}
