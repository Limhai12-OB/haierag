# HaieRag API Contracts

This file is the single source of truth for the interfaces between the frontend, the backend and the AI service.
The database schema lives in `backend/src/main/resources/db/migration/` (Flyway owns it).

Conventions
* JSON uses camelCase. IDs are UUID strings. Timestamps are ISO-8601 UTC strings.
* Errors use RFC 7807 `application/problem+json`: `{ "type", "title", "status", "detail", "instance", "errors"?: {field: message} }`.
* Status codes: 400 validation, 401 unauthenticated, 403 forbidden, 404 not found (also used when a resource exists in a workspace the caller can't see), 409 conflict, 413 file too large, 415 unsupported type, 429 rate limited, 503 AI service/model unavailable.

---

## 1. Public backend API (`http://localhost:8080/api/v1`)

Browser auth: `Authorization: Bearer <accessToken>`. The refresh token is an **httpOnly cookie** `haierag_refresh`
(`Path=/api/v1/auth`, `SameSite=Strict`, `Secure` when `APP_ENV=production`). The frontend reaches the backend
same-origin through the Next.js rewrite `/api/v1/* → BACKEND_URL/api/v1/*`, so cookies work without CORS.

### Auth
| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/auth/register` | `{email, password, displayName}` (password ≥ 8 chars) | 201 `AuthResponse` + cookie |
| POST | `/auth/login` | `{email, password}` | 200 `AuthResponse` + cookie |
| POST | `/auth/refresh` | – (cookie) | 200 `AuthResponse` + rotated cookie |
| POST | `/auth/logout` | – (cookie) | 204, cookie cleared, token family revoked |
| GET | `/auth/me` | – | 200 `User` |
| PUT | `/auth/me` | `{displayName}` | 200 `User` |

```ts
type User = { id: string; email: string; displayName: string; systemRole: "ADMIN" | "USER"; createdAt: string };
type AuthResponse = { accessToken: string; tokenType: "Bearer"; expiresIn: number /* seconds */; user: User };
```

### Workspaces
Roles: `OWNER` (everything incl. delete/members), `MEMBER` (upload, manage collections/documents, chat), `VIEWER` (read + chat).
System `ADMIN` may read every workspace.

| Method | Path | Body | Response | Min role |
|---|---|---|---|---|
| GET | `/workspaces` | – | `Workspace[]` (caller's) | – |
| POST | `/workspaces` | `{name, description?}` | 201 `Workspace` (caller becomes OWNER) | – |
| GET | `/workspaces/{id}` | – | `Workspace` | VIEWER |
| PUT | `/workspaces/{id}` | `{name, description?}` | `Workspace` | OWNER |
| DELETE | `/workspaces/{id}` | – | 204 | OWNER |
| GET | `/workspaces/{id}/members` | – | `Member[]` | VIEWER |
| POST | `/workspaces/{id}/members` | `{email, role}` (existing user) | 201 `Member` | OWNER |
| PUT | `/workspaces/{id}/members/{userId}` | `{role}` | `Member` | OWNER |
| DELETE | `/workspaces/{id}/members/{userId}` | – | 204 (last OWNER cannot be removed) | OWNER |
| GET | `/workspaces/{id}/stats` | – | `WorkspaceStats` | VIEWER |
| GET | `/workspaces/{id}/activity` | – | `Activity[]` (latest 50 audit entries) | VIEWER |

```ts
type Role = "OWNER" | "MEMBER" | "VIEWER";
type Workspace = { id: string; name: string; description: string | null; role: Role; createdAt: string; updatedAt: string };
type Member = { userId: string; email: string; displayName: string; role: Role; joinedAt: string };
type WorkspaceStats = { documents: number; collections: number; chunks: number; conversations: number;
                        documentsByStatus: Record<DocumentStatus, number> };
type Activity = { id: number; action: string; entityType: string | null; entityId: string | null;
                  actorName: string | null; details: Record<string, unknown>; createdAt: string };
```

### Collections
| Method | Path | Body | Response | Min role |
|---|---|---|---|---|
| GET | `/workspaces/{workspaceId}/collections` | – | `Collection[]` | VIEWER |
| POST | `/workspaces/{workspaceId}/collections` | `{name, description?}` | 201 `Collection` | MEMBER |
| PUT | `/collections/{id}` | `{name, description?}` | `Collection` | MEMBER |
| DELETE | `/collections/{id}` | – | 204 (documents become un-collected) | MEMBER |

```ts
type Collection = { id: string; workspaceId: string; name: string; description: string | null;
                    documentCount: number; createdAt: string; updatedAt: string };
```

### Documents
Allowed types: PDF, DOCX, XLSX, PPTX, TXT, MD, CSV. Max size `MAX_UPLOAD_SIZE_MB` (default 50). Type is checked by
extension **and** magic bytes / UTF-8 validity.

| Method | Path | Body | Response | Min role |
|---|---|---|---|---|
| POST | `/workspaces/{workspaceId}/documents` | multipart: `file`, `collectionId?` | 202 `Document` (status QUEUED) | MEMBER |
| GET | `/workspaces/{workspaceId}/documents?collectionId=&status=&q=` | – | `Document[]` (newest first) | VIEWER |
| GET | `/documents/{id}` | – | `Document` | VIEWER |
| PATCH | `/documents/{id}` | `{name?, collectionId?}` (`collectionId: null` removes) | `Document` | MEMBER |
| GET | `/documents/{id}/status` | – | `DocumentStatusInfo` | VIEWER |
| GET | `/documents/{id}/chunks?page=0&size=50` | – | `Page<Chunk>` | VIEWER |
| GET | `/documents/{id}/download` | – | original bytes, `Content-Disposition: attachment` | VIEWER |
| POST | `/documents/{id}/reprocess` | – | 202 `Document` | MEMBER |
| DELETE | `/documents/{id}` | – | 204 (also deletes stored objects) | MEMBER |

```ts
type DocumentStatus = "UPLOADED" | "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";
type Document = { id: string; workspaceId: string; collectionId: string | null; collectionName: string | null;
  name: string; originalFilename: string; contentType: string; fileType: "PDF"|"DOCX"|"XLSX"|"PPTX"|"TXT"|"MARKDOWN"|"CSV";
  sizeBytes: number; status: DocumentStatus; errorMessage: string | null; pageCount: number | null; chunkCount: number;
  uploadedBy: string | null; processedAt: string | null; createdAt: string; updatedAt: string };
type DocumentStatusInfo = { documentId: string; status: DocumentStatus; errorMessage: string | null;
  job: { id: string; status: string; stage: string | null; attempts: number; startedAt: string | null;
         finishedAt: string | null; metrics: Record<string, unknown> } | null };
type Chunk = { id: string; chunkIndex: number; content: string; tokenCount: number; pageStart: number | null;
  pageEnd: number | null; sectionHeading: string | null; metadata: Record<string, unknown> };
type Page<T> = { content: T[]; page: number; size: number; totalElements: number; totalPages: number };
```

### Conversations & chat
| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/conversations` | `{workspaceId, title?, scopeType?: "WORKSPACE"\|"COLLECTION"\|"DOCUMENTS", collectionId?, documentIds?}` | 201 `Conversation` |
| GET | `/conversations?workspaceId=` | – | `Conversation[]` (caller's, newest first) |
| GET | `/conversations/{id}` | – | `ConversationDetail` |
| PATCH | `/conversations/{id}` | `{title}` | `Conversation` |
| DELETE | `/conversations/{id}` | – | 204 |
| POST | `/conversations/{id}/messages` | `{content}` | `text/event-stream` (see below) |
| POST | `/conversations/{id}/regenerate` | – | `text/event-stream`; replaces the last assistant message |

Conversations are private to their creator; the creator must still be a member (≥ VIEWER) of the workspace.

```ts
type Conversation = { id: string; workspaceId: string; title: string; scopeType: "WORKSPACE"|"COLLECTION"|"DOCUMENTS";
  collectionId: string | null; documentIds: string[]; createdAt: string; updatedAt: string };
type Citation = { marker: number; chunkId: string | null; documentId: string | null; documentName: string;
  pageNumber: number | null; sectionHeading: string | null; excerpt: string;
  retrievalScore: number | null; rerankScore: number | null };
type Message = { id: string; role: "USER" | "ASSISTANT"; content: string; status: "STREAMING"|"COMPLETED"|"FAILED";
  citations: Citation[]; metadata: Record<string, unknown>; createdAt: string };
type ConversationDetail = Conversation & { messages: Message[] };
```

**Chat SSE stream** (backend → browser). Each event is `event: <name>\ndata: <json>\n\n`:

| event | data |
|---|---|
| `user_message` | `Message` (the persisted user message) |
| `meta` | `{ retrieval: { candidates: number, passages: number, timingsMs: Record<string, number> } }` |
| `token` | `{ text: string }` |
| `citations` | `{ citations: Citation[] }` |
| `done` | `{ message: Message }` (persisted assistant message, citations validated) |
| `error` | `{ code: string, message: string }` — stream ends afterwards |

The browser uses `fetch()` + a stream reader (not `EventSource`, which cannot POST or send headers).

### System
| Method | Path | Response |
|---|---|---|
| GET | `/system/health` | `{ backend: "UP", database, redis, storage, aiService: AiHealth }` |
| GET | `/admin/users` (ADMIN) | `User[]` |
| GET | `/admin/jobs?status=` (ADMIN) | recent processing jobs |

OpenAPI UI: `/swagger-ui.html`, spec: `/v3/api-docs`.

---

## 2. Internal AI service API (`http://ai-service:8000`)

Every endpoint except `GET /health/live` requires header `X-Internal-Token: ${INTERNAL_API_TOKEN}`.
The AI service port is **not** published outside the Docker network.

### Ingestion queue (Redis)
The backend, after committing the document/version/job rows, does
`LPUSH haierag:ingest:queue {"jobId": "...", "documentId": "...", "versionId": "..."}`.
The AI worker `BRPOP`s, sets job/document `PROCESSING`, parses the object at `document_versions.storage_key` from
the bucket, replaces the chunks/embeddings of that document, and sets `COMPLETED` (or `FAILED` + `error_message`).
Fallback: `POST /internal/v1/ingest/jobs/{jobId}` enqueues the same message (used by tests/tools).

### Endpoints
| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/health/live` | – | `{status: "ok"}` |
| GET | `/health` | – | `AiHealth` |
| POST | `/internal/v1/embeddings` | `{texts: string[]}` | `{model, dimensions, embeddings: number[][]}` |
| POST | `/internal/v1/retrieve` | `RetrieveRequest` | `{passages: Passage[], timingsMs}` |
| POST | `/internal/v1/chat` | `ChatRequest` | `text/event-stream` |
| GET | `/internal/v1/config` | – | effective model/retrieval config |

```ts
type Scope = { workspaceId: string; collectionId?: string | null; documentIds?: string[] | null };
type RetrieveRequest = Scope & { query: string; topK?: number; rerank?: boolean };
type Passage = { chunkId: string; documentId: string; documentName: string; chunkIndex: number; content: string;
  pageStart: number | null; pageEnd: number | null; sectionHeading: string | null;
  vectorRank: number | null; keywordRank: number | null; rrfScore: number; rerankScore: number | null };
type ChatRequest = Scope & { question: string; history: { role: "USER" | "ASSISTANT"; content: string }[] };
type AiHealth = { status: "ok" | "degraded" | "down";
  components: Record<"ollama"|"llm"|"embedding"|"reranker"|"postgres"|"redis"|"storage",
                     { status: "ok" | "degraded" | "down"; detail?: string; [k: string]: unknown }> };
```

AI chat SSE events (AI service → backend): `meta`, `token`, `citations`, `done`, `error`, same shapes as the public
stream except that `done` carries
`{ answer: string, grounded: boolean, model: string, promptTokens: number|null, completionTokens: number|null, timingsMs }`
and `citations` items have no persisted ids. The backend persists the assistant message (content = `answer`,
which has invalid citation markers removed) and the citations, then emits the public `done`.

Errors before streaming starts return problem JSON with 4xx/503. Errors after streaming starts are an `error` event.
Model-unavailable errors use code `MODEL_UNAVAILABLE` with an actionable message (e.g. `ollama pull bge-m3`).

---

## Backend deviations

Clarifications/choices made by the backend implementation where the contract above was silent or ambiguous:

* **SSE framing**: Spring writes `event:<name>\ndata:<json>\n\n` (no space after the colon) — valid SSE; parsers must strip an optional single space.
* **Chat errors**: problems detected *before* streaming (400 validation, 404 conversation, 409 scope gone, 429 rate limit) are
  `application/problem+json` responses. Everything involving the AI service (including the AI's own pre-stream 4xx/503)
  arrives as an `error` event inside a 200 `text/event-stream`, after `user_message`. Codes: the AI's `code` when present
  (e.g. `MODEL_UNAVAILABLE`), else `AI_UNAVAILABLE` (unreachable / 503 / stream ended without `done`), `AI_ERROR`, `INTERNAL_ERROR`.
  The assistant message is then stored with `status: FAILED`, partial content, and `metadata.errorCode/errorMessage`.
* **Citations**: the backend re-validates AI citations: items whose `chunkId` (or, without one, `documentId`) is not in the
  conversation's workspace are dropped; `documentId`/`documentName` are taken from the database. The streamed `citations`
  event already carries the validated list. Duplicate markers keep the first.
* **Assistant `metadata`**: `{ retrieval, latencyMs, grounded, model, promptTokens, completionTokens, timingsMs }`.
* **Regenerate**: no `user_message` event. Re-answers the latest USER message with history before it; the previous
  assistant message (if the last message is one) is deleted and a new one (new id) is inserted when the stream ends
  (success or failure). 409 if the conversation has no messages.
* **Auto-title**: a conversation created without a title is called `New conversation`; the first question (≤ 80 chars) replaces it.
* **Scope**: `scopeType` is inferred when omitted (`documentIds` → DOCUMENTS, `collectionId` → COLLECTION, else WORKSPACE).
  Foreign/unknown collection or document ids → 400 with `errors`. If the scoped collection/all scoped documents were deleted,
  sending a message → 409.
* **`GET /conversations`** without `workspaceId` returns the caller's conversations across workspaces they still belong to.
* **System ADMIN** who is not a member sees a workspace with `role: "VIEWER"` (read + chat); write operations return 404 as for any non-member.
* **Members**: adding an unknown email → 404, an existing member → 409; demoting/removing the last OWNER → 409.
* **Documents**: `uploadedBy` is the uploader's user id. `contentType` is derived from the detected type (client value ignored).
  Empty file → 400. `name` defaults to the original filename. `PATCH` with a collection outside the workspace → 400.
  `POST /reprocess` → 409 while a job for the document is `QUEUED`/`PROCESSING`. If the Redis push fails after commit,
  the job stays `QUEUED` in the DB (the worker's start-up re-enqueue picks it up, ADR-003).
  Object key filename is ASCII-sanitised: `[^A-Za-z0-9._-]` → `_`, max 120 chars.
* **`GET /system/health`** is public; `database`/`redis`/`storage` are `"UP"`/`"DOWN"`; `aiService` is the AI `/health`
  body, or `{status:"down", components:{}, detail}` when unreachable (3 s timeout).
* **`GET /admin/jobs`** returns up to 200 `{ id, documentId, documentName, workspaceId, status, stage, attempts,
  errorMessage, metrics, startedAt, finishedAt, createdAt }`, newest first.
* **Rate limits** (Redis fixed 60 s window, 429 + `Retry-After`): register/login/refresh 20/min per client IP
  (`RATE_LIMIT_AUTH_PER_MINUTE`), chat messages/regenerate 20/min per user (`RATE_LIMIT_CHAT_PER_MINUTE`). Fails open if Redis is down.
* Refresh failures (401) also clear the `haierag_refresh` cookie.
