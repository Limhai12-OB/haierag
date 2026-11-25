package com.haierag.ai;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.Test;

class SseParserTest {

    @Test
    void parsesEventsCommentsMultiLineDataAndCrLf() throws Exception {
        String raw = ": keep-alive\r\nevent: token\r\ndata: {\"text\":\"a\"}\r\n\r\n"
                + "event:meta\ndata:line1\ndata: line2\n\n"
                + "data: no-event-name\n\n"
                + "event: done\ndata: {}";
        List<String> out = new ArrayList<>();
        AiClient.readSse(new ByteArrayInputStream(raw.getBytes(StandardCharsets.UTF_8)), (e, d) -> out.add(e + "|" + d));
        assertThat(out).containsExactly("token|{\"text\":\"a\"}", "meta|line1\nline2", "message|no-event-name", "done|{}");
    }
}
