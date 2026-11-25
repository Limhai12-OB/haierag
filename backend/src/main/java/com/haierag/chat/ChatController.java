package com.haierag.chat;

import java.util.UUID;

import jakarta.validation.Valid;

import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import com.haierag.auth.CurrentUser;
import com.haierag.conversation.ConversationDtos.SendMessageRequest;

@RestController
@RequestMapping("/api/v1/conversations")
public class ChatController {

    private final ChatService chat;

    public ChatController(ChatService chat) {
        this.chat = chat;
    }

    @PostMapping("/{id}/messages")
    public ResponseEntity<SseEmitter> send(@PathVariable UUID id, @Valid @RequestBody SendMessageRequest body,
                                           CurrentUser user) {
        return stream(chat.sendMessage(id, body.content(), user));
    }

    @PostMapping("/{id}/regenerate")
    public ResponseEntity<SseEmitter> regenerate(@PathVariable UUID id, CurrentUser user) {
        return stream(chat.regenerate(id, user));
    }

    private static ResponseEntity<SseEmitter> stream(SseEmitter emitter) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noCache())
                .header("X-Accel-Buffering", "no")
                .contentType(MediaType.TEXT_EVENT_STREAM)
                .body(emitter);
    }
}
