package com.haierag.workspace;

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
import com.haierag.workspace.WorkspaceDtos.Activity;
import com.haierag.workspace.WorkspaceDtos.AddMemberRequest;
import com.haierag.workspace.WorkspaceDtos.MemberDto;
import com.haierag.workspace.WorkspaceDtos.UpdateMemberRequest;
import com.haierag.workspace.WorkspaceDtos.WorkspaceDto;
import com.haierag.workspace.WorkspaceDtos.WorkspaceRequest;
import com.haierag.workspace.WorkspaceDtos.WorkspaceStats;

@RestController
@RequestMapping("/api/v1/workspaces")
public class WorkspaceController {

    private final WorkspaceService service;

    public WorkspaceController(WorkspaceService service) {
        this.service = service;
    }

    @GetMapping
    public List<WorkspaceDto> list(CurrentUser user) {
        return service.list(user);
    }

    @PostMapping
    public ResponseEntity<WorkspaceDto> create(@Valid @RequestBody WorkspaceRequest body, CurrentUser user) {
        return ResponseEntity.status(HttpStatus.CREATED).body(service.create(body, user));
    }

    @GetMapping("/{id}")
    public WorkspaceDto get(@PathVariable UUID id, CurrentUser user) {
        return service.get(id, user);
    }

    @PutMapping("/{id}")
    public WorkspaceDto update(@PathVariable UUID id, @Valid @RequestBody WorkspaceRequest body, CurrentUser user) {
        return service.update(id, body, user);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable UUID id, CurrentUser user) {
        service.delete(id, user);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/{id}/members")
    public List<MemberDto> members(@PathVariable UUID id, CurrentUser user) {
        return service.members(id, user);
    }

    @PostMapping("/{id}/members")
    public ResponseEntity<MemberDto> addMember(@PathVariable UUID id, @Valid @RequestBody AddMemberRequest body,
                                               CurrentUser user) {
        return ResponseEntity.status(HttpStatus.CREATED).body(service.addMember(id, body, user));
    }

    @PutMapping("/{id}/members/{userId}")
    public MemberDto updateMember(@PathVariable UUID id, @PathVariable UUID userId,
                                  @Valid @RequestBody UpdateMemberRequest body, CurrentUser user) {
        return service.updateMember(id, userId, body.role(), user);
    }

    @DeleteMapping("/{id}/members/{userId}")
    public ResponseEntity<Void> removeMember(@PathVariable UUID id, @PathVariable UUID userId, CurrentUser user) {
        service.removeMember(id, userId, user);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/{id}/stats")
    public WorkspaceStats stats(@PathVariable UUID id, CurrentUser user) {
        return service.stats(id, user);
    }

    @GetMapping("/{id}/activity")
    public List<Activity> activity(@PathVariable UUID id, CurrentUser user) {
        return service.activity(id, user);
    }
}
