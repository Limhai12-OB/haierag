package com.haierag.conversation;

import java.util.List;
import java.util.UUID;

import jakarta.validation.Valid;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.haierag.auth.CurrentUser;
import com.haierag.conversation.ConversationDtos.ConversationDetail;
import com.haierag.conversation.ConversationDtos.ConversationDto;
import com.haierag.conversation.ConversationDtos.CreateConversationRequest;
import com.haierag.conversation.ConversationDtos.RenameRequest;

@RestController
@RequestMapping("/api/v1/conversations")
public class ConversationController {

    private final ConversationService service;

    public ConversationController(ConversationService service) {
        this.service = service;
    }

    @PostMapping
    public ResponseEntity<ConversationDto> create(@Valid @RequestBody CreateConversationRequest body, CurrentUser user) {
        return ResponseEntity.status(HttpStatus.CREATED).body(service.create(body, user));
    }

    @GetMapping
    public List<ConversationDto> list(@RequestParam(required = false) UUID workspaceId, CurrentUser user) {
        return service.list(workspaceId, user);
    }

    @GetMapping("/{id}")
    public ConversationDetail get(@PathVariable UUID id, CurrentUser user) {
        return service.detail(id, user);
    }

    @PatchMapping("/{id}")
    public ConversationDto rename(@PathVariable UUID id, @Valid @RequestBody RenameRequest body, CurrentUser user) {
        return service.rename(id, body.title(), user);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable UUID id, CurrentUser user) {
        service.delete(id, user);
        return ResponseEntity.noContent().build();
    }
}
