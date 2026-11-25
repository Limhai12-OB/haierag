package com.haierag.collection;

import java.util.List;
import java.util.UUID;

import jakarta.validation.Valid;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.haierag.auth.CurrentUser;
import com.haierag.collection.CollectionDtos.CollectionDto;
import com.haierag.collection.CollectionDtos.CollectionRequest;

@RestController
@RequestMapping("/api/v1")
public class CollectionController {

    private final CollectionService service;

    public CollectionController(CollectionService service) {
        this.service = service;
    }

    @GetMapping("/workspaces/{workspaceId}/collections")
    public List<CollectionDto> list(@PathVariable UUID workspaceId, CurrentUser user) {
        return service.list(workspaceId, user);
    }

    @PostMapping("/workspaces/{workspaceId}/collections")
    public ResponseEntity<CollectionDto> create(@PathVariable UUID workspaceId,
                                                @Valid @RequestBody CollectionRequest body, CurrentUser user) {
        return ResponseEntity.status(HttpStatus.CREATED).body(service.create(workspaceId, body, user));
    }

    @PutMapping("/collections/{id}")
    public CollectionDto update(@PathVariable UUID id, @Valid @RequestBody CollectionRequest body, CurrentUser user) {
        return service.update(id, body, user);
    }

    @DeleteMapping("/collections/{id}")
    public ResponseEntity<Void> delete(@PathVariable UUID id, CurrentUser user) {
        service.delete(id, user);
        return ResponseEntity.noContent().build();
    }
}
