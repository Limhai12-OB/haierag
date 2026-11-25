package com.haierag.system;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;

import com.haierag.support.IntegrationTest;

class SystemHealthIT extends IntegrationTest {

    @Test
    void actuatorAndSystemHealthAreUp() throws Exception {
        mvc.perform(get("/actuator/health")).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("UP"));
        mvc.perform(get("/api/v1/system/health")).andExpect(status().isOk())
                .andExpect(jsonPath("$.backend").value("UP"))
                .andExpect(jsonPath("$.database").value("UP"))
                .andExpect(jsonPath("$.redis").value("UP"))
                .andExpect(jsonPath("$.storage").value("UP"))
                .andExpect(jsonPath("$.aiService.status").value("ok"));
    }

    @Test
    void openApiSpecIsServed() throws Exception {
        mvc.perform(get("/v3/api-docs")).andExpect(status().isOk())
                .andExpect(jsonPath("$.paths['/api/v1/workspaces']").exists());
    }
}
