package com.haierag.workspace;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MvcResult;

import com.haierag.support.Files;
import com.haierag.support.IntegrationTest;

class AuthorizationIT extends IntegrationTest {

    private UUID upload(TestUser user, UUID ws) throws Exception {
        MvcResult res = mvc.perform(auth(multipart("/api/v1/workspaces/" + ws + "/documents")
                        .file(new MockMultipartFile("file", "a.pdf", "application/pdf", Files.pdf())), user))
                .andExpect(status().isAccepted()).andReturn();
        return UUID.fromString(body(res).get("id").asString());
    }

    @Test
    void rolesAreEnforcedAndOtherWorkspacesAreInvisible() throws Exception {
        TestUser owner = register("owner");
        TestUser member = register("member");
        TestUser viewer = register("viewer");
        TestUser outsider = register("outsider");
        UUID ws = createWorkspace(owner, "Team");
        addMember(owner, ws, member, "MEMBER");
        addMember(owner, ws, viewer, "VIEWER");

        // VIEWER: can read, cannot upload or manage collections
        mvc.perform(auth(get("/api/v1/workspaces/" + ws), viewer)).andExpect(status().isOk())
                .andExpect(jsonPath("$.role").value("VIEWER"));
        mvc.perform(auth(multipart("/api/v1/workspaces/" + ws + "/documents")
                        .file(new MockMultipartFile("file", "a.pdf", "application/pdf", Files.pdf())), viewer))
                .andExpect(status().isForbidden());
        mvc.perform(auth(post("/api/v1/workspaces/" + ws + "/collections"), viewer)
                        .contentType(MediaType.APPLICATION_JSON).content(jsonOf(Map.of("name", "Nope"))))
                .andExpect(status().isForbidden());

        // MEMBER can upload and create collections, but not manage members
        UUID doc = upload(member, ws);
        MvcResult col = mvc.perform(auth(post("/api/v1/workspaces/" + ws + "/collections"), member)
                        .contentType(MediaType.APPLICATION_JSON).content(jsonOf(Map.of("name", "Specs"))))
                .andExpect(status().isCreated()).andReturn();
        UUID collectionId = UUID.fromString(body(col).get("id").asString());
        mvc.perform(auth(post("/api/v1/workspaces/" + ws + "/members"), member)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(jsonOf(Map.of("email", outsider.email(), "role", "VIEWER"))))
                .andExpect(status().isForbidden());
        mvc.perform(auth(get("/api/v1/documents/" + doc), viewer)).andExpect(status().isOk());

        // duplicate collection name -> 409
        mvc.perform(auth(post("/api/v1/workspaces/" + ws + "/collections"), member)
                        .contentType(MediaType.APPLICATION_JSON).content(jsonOf(Map.of("name", "specs"))))
                .andExpect(status().isConflict());

        // Conversation of the owner
        MvcResult conv = mvc.perform(auth(post("/api/v1/conversations"), owner).contentType(MediaType.APPLICATION_JSON)
                        .content(jsonOf(Map.of("workspaceId", ws.toString()))))
                .andExpect(status().isCreated()).andReturn();
        UUID conversationId = UUID.fromString(body(conv).get("id").asString());

        // Outsider: everything is 404
        mvc.perform(auth(get("/api/v1/workspaces/" + ws), outsider)).andExpect(status().isNotFound());
        mvc.perform(auth(get("/api/v1/documents/" + doc), outsider)).andExpect(status().isNotFound());
        mvc.perform(auth(get("/api/v1/documents/" + doc + "/download"), outsider)).andExpect(status().isNotFound());
        mvc.perform(auth(delete("/api/v1/documents/" + doc), outsider)).andExpect(status().isNotFound());
        mvc.perform(auth(get("/api/v1/workspaces/" + ws + "/collections"), outsider)).andExpect(status().isNotFound());
        mvc.perform(auth(put("/api/v1/collections/" + collectionId), outsider).contentType(MediaType.APPLICATION_JSON)
                .content(jsonOf(Map.of("name", "x")))).andExpect(status().isNotFound());
        mvc.perform(auth(delete("/api/v1/collections/" + collectionId), outsider)).andExpect(status().isNotFound());
        mvc.perform(auth(get("/api/v1/conversations/" + conversationId), outsider)).andExpect(status().isNotFound());
        mvc.perform(auth(post("/api/v1/conversations/" + conversationId + "/messages"), outsider)
                .contentType(MediaType.APPLICATION_JSON).content(jsonOf(Map.of("content", "hi"))))
                .andExpect(status().isNotFound());
        // Conversations are private even to workspace members
        mvc.perform(auth(get("/api/v1/conversations/" + conversationId), member)).andExpect(status().isNotFound());
        // An outsider cannot scope a conversation to another workspace's document
        UUID ownWs = createWorkspace(outsider, "Mine");
        mvc.perform(auth(post("/api/v1/conversations"), outsider).contentType(MediaType.APPLICATION_JSON)
                        .content(jsonOf(Map.of("workspaceId", ownWs.toString(), "scopeType", "DOCUMENTS",
                                "documentIds", java.util.List.of(doc.toString())))))
                .andExpect(status().isBadRequest());
        // ... nor move a document into a foreign collection
        mvc.perform(auth(patch("/api/v1/documents/" + doc), member).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"collectionId\":\"" + UUID.randomUUID() + "\"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(auth(patch("/api/v1/documents/" + doc), member).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"collectionId\":\"" + collectionId + "\",\"name\":\"Renamed.pdf\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.collectionName").value("Specs"))
                .andExpect(jsonPath("$.name").value("Renamed.pdf"));
        mvc.perform(auth(patch("/api/v1/documents/" + doc), member).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"collectionId\":null}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.collectionId").doesNotExist());

        // Member management: last owner protection
        mvc.perform(auth(delete("/api/v1/workspaces/" + ws + "/members/" + owner.id()), owner))
                .andExpect(status().isConflict());
        mvc.perform(auth(put("/api/v1/workspaces/" + ws + "/members/" + owner.id()), owner)
                        .contentType(MediaType.APPLICATION_JSON).content(jsonOf(Map.of("role", "MEMBER"))))
                .andExpect(status().isConflict());
        mvc.perform(auth(put("/api/v1/workspaces/" + ws + "/members/" + viewer.id()), owner)
                        .contentType(MediaType.APPLICATION_JSON).content(jsonOf(Map.of("role", "MEMBER"))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.role").value("MEMBER"));
        mvc.perform(auth(delete("/api/v1/workspaces/" + ws + "/members/" + viewer.id()), owner))
                .andExpect(status().isNoContent());
        mvc.perform(auth(get("/api/v1/workspaces/" + ws), viewer)).andExpect(status().isNotFound());

        // Stats & activity
        mvc.perform(auth(get("/api/v1/workspaces/" + ws + "/stats"), member)).andExpect(status().isOk())
                .andExpect(jsonPath("$.documents").value(1))
                .andExpect(jsonPath("$.collections").value(1))
                .andExpect(jsonPath("$.documentsByStatus.QUEUED").value(1))
                .andExpect(jsonPath("$.documentsByStatus.COMPLETED").value(0));
        mvc.perform(auth(get("/api/v1/workspaces/" + ws + "/activity"), member)).andExpect(status().isOk())
                .andExpect(jsonPath("$[0].action").value("member.remove"))
                .andExpect(jsonPath("$[?(@.action == 'document.upload')]").exists())
                .andExpect(jsonPath("$[?(@.action == 'workspace.create')]").exists());

        // Owner deletes the workspace; it disappears for everyone
        mvc.perform(auth(delete("/api/v1/workspaces/" + ws), member)).andExpect(status().isForbidden());
        mvc.perform(auth(delete("/api/v1/workspaces/" + ws), owner)).andExpect(status().isNoContent());
        mvc.perform(auth(get("/api/v1/documents/" + doc), owner)).andExpect(status().isNotFound());
    }
}
