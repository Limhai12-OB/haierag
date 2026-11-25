#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-unused-vars -- destructuring is used to omit fields */
/**
 * In-memory mock of the HaieRag public API (docs/api/contracts.md §1) for frontend development
 * when the Spring Boot backend isn't running. NOT for production.
 *
 *   pnpm mock:backend                      # listens on :8099
 *   BACKEND_URL=http://localhost:8099 pnpm dev
 *
 * Seed login: admin@haierag.local / password123 (ADMIN)
 */
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.MOCK_PORT || 8099);
const now = () => new Date().toISOString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- state
const users = new Map(); // id -> user (with password)
const tokens = new Map(); // access token -> userId
const refresh = new Map(); // refresh token -> userId
const workspaces = new Map(); // id -> {.., members: Map<userId, {role, joinedAt}>}
const collections = new Map();
const documents = new Map();
const chunks = new Map(); // docId -> Chunk[]
const conversations = new Map();
const activity = [];
let activitySeq = 1;

function addUser(email, password, displayName, systemRole = "USER") {
  const u = { id: randomUUID(), email, password, displayName, systemRole, createdAt: now() };
  users.set(u.id, u);
  return u;
}
const publicUser = ({ password: _p, ...u }) => u;

function log(wsId, actor, action, entityType, entityId, details = {}) {
  activity.unshift({ wsId, id: activitySeq++, action, entityType, entityId, actorName: actor?.displayName ?? null, details, createdAt: now() });
}

const admin = addUser("admin@haierag.local", "password123", "Admin", "ADMIN");
const ws0 = { id: randomUUID(), name: "Demo workspace", description: "Seeded by the mock backend", createdAt: now(), updatedAt: now(), members: new Map([[admin.id, { role: "OWNER", joinedAt: now() }]]) };
workspaces.set(ws0.id, ws0);
const col0 = { id: randomUUID(), workspaceId: ws0.id, name: "Reports", description: null, createdAt: now(), updatedAt: now() };
collections.set(col0.id, col0);

function makeDoc(wsId, name, size, collectionId, uploadedBy) {
  const ext = name.split(".").pop().toLowerCase();
  const fileType = { pdf: "PDF", docx: "DOCX", xlsx: "XLSX", pptx: "PPTX", txt: "TXT", md: "MARKDOWN", csv: "CSV" }[ext] ?? "TXT";
  const d = { id: randomUUID(), workspaceId: wsId, collectionId: collectionId || null, name, originalFilename: name, contentType: "application/octet-stream", fileType, sizeBytes: size, status: "QUEUED", errorMessage: null, pageCount: null, chunkCount: 0, uploadedBy, processedAt: null, createdAt: now(), updatedAt: now(), job: { id: randomUUID(), status: "QUEUED", stage: null, attempts: 1, startedAt: null, finishedAt: null, metrics: {} } };
  documents.set(d.id, d);
  simulateIngest(d);
  return d;
}

async function simulateIngest(d) {
  await sleep(1500);
  if (!documents.has(d.id)) return;
  Object.assign(d, { status: "PROCESSING", updatedAt: now() });
  Object.assign(d.job, { status: "PROCESSING", stage: "parsing", startedAt: now() });
  await sleep(1500);
  d.job.stage = "embedding";
  await sleep(1500);
  if (!documents.has(d.id)) return;
  if (d.name.toLowerCase().includes("fail")) {
    Object.assign(d, { status: "FAILED", errorMessage: "Parser error: file appears to be corrupted", updatedAt: now() });
    Object.assign(d.job, { status: "FAILED", finishedAt: now() });
    return;
  }
  const list = Array.from({ length: 45 }, (_, i) => ({
    id: randomUUID(), chunkIndex: i, tokenCount: 180 + (i % 7) * 13, pageStart: Math.floor(i / 3) + 1, pageEnd: Math.floor(i / 3) + 1,
    sectionHeading: i % 5 === 0 ? `Section ${i / 5 + 1}` : null,
    content: `Chunk ${i} of ${d.name}. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Revenue grew ${i}% in the period.`, metadata: {},
  }));
  chunks.set(d.id, list);
  Object.assign(d, { status: "COMPLETED", chunkCount: list.length, pageCount: 15, processedAt: now(), updatedAt: now() });
  Object.assign(d.job, { status: "COMPLETED", stage: "done", finishedAt: now(), metrics: { chunks: list.length, parseMs: 812, embedMs: 2304 } });
}

makeDoc(ws0.id, "Annual Report 2025.pdf", 2_400_000, col0.id, admin.id);
makeDoc(ws0.id, "Onboarding guide.md", 12_000, null, admin.id);

// ---------------------------------------------------------------- helpers
const problem = (res, status, detail, extra = {}) => send(res, status, { type: "about:blank", title: ["", "Error"][1], status, detail, ...extra }, "application/problem+json");
function send(res, status, body, type = "application/json", headers = {}) {
  if (status === 204) { res.writeHead(204, headers); return res.end(); }
  res.writeHead(status, { "content-type": type, ...headers });
  res.end(JSON.stringify(body));
}
async function readBody(req) {
  const parts = [];
  for await (const c of req) parts.push(c);
  return Buffer.concat(parts);
}
async function json(req) {
  const b = await readBody(req);
  try { return b.length ? JSON.parse(b.toString("utf8")) : {}; } catch { return {}; }
}
function cookie(req, name) {
  const m = new RegExp(`(?:^|; )${name}=([^;]+)`).exec(req.headers.cookie || "");
  return m ? m[1] : null;
}
function issue(res, user, status = 200) {
  const access = randomUUID();
  const rt = randomUUID();
  tokens.set(access, user.id);
  refresh.set(rt, user.id);
  send(res, status, { accessToken: access, tokenType: "Bearer", expiresIn: 900, user: publicUser(user) }, "application/json", {
    "set-cookie": `haierag_refresh=${rt}; Path=/api/v1/auth; HttpOnly; SameSite=Strict; Max-Age=604800`,
  });
}
const wsView = (w, uid) => ({ id: w.id, name: w.name, description: w.description, role: w.members.get(uid)?.role ?? "VIEWER", createdAt: w.createdAt, updatedAt: w.updatedAt });
const colView = (c) => ({ ...c, documentCount: [...documents.values()].filter((d) => d.collectionId === c.id).length });
const docView = ({ job: _j, ...d }) => ({ ...d, collectionName: d.collectionId ? collections.get(d.collectionId)?.name ?? null : null });
const roleRank = { VIEWER: 0, MEMBER: 1, OWNER: 2 };
function access(res, user, wsId, min = "VIEWER") {
  const w = workspaces.get(wsId);
  const m = w?.members.get(user.id);
  if (!w || (!m && user.systemRole !== "ADMIN")) { problem(res, 404, "Workspace not found"); return null; }
  if (roleRank[m?.role ?? "VIEWER"] < roleRank[min]) { problem(res, 403, "Insufficient role"); return null; }
  return w;
}

// ---------------------------------------------------------------- chat
async function streamAnswer(req, res, conv, user, question) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  const ev = (name, data) => res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
  let closed = false;
  req.on("close", () => (closed = true));
  if (question !== null) {
    const um = { id: randomUUID(), role: "USER", content: question, status: "COMPLETED", citations: [], metadata: {}, createdAt: now() };
    conv.messages.push(um);
    ev("user_message", um);
  }
  await sleep(400);
  ev("meta", { retrieval: { candidates: 40, passages: 3, timingsMs: { embed: 41, vector: 18, keyword: 9, rerank: 312, total: 395 } } });
  const docs = [...documents.values()].filter((d) => d.workspaceId === conv.workspaceId && d.status === "COMPLETED");
  if ((question ?? "").toLowerCase().includes("error")) {
    await sleep(300);
    ev("error", { code: "MODEL_UNAVAILABLE", message: "Model qwen3:8b is not available. Run: ollama pull qwen3:8b" });
    return res.end();
  }
  const answer = docs.length
    ? `Based on the documents, **revenue grew 12%** year over year [1]. Operating costs fell after the consolidation [2].\n\n- Growth was driven by new customers [1]\n- Margins improved [2]\n\n\`\`\`\ncode stays [3] literal\n\`\`\``
    : "I couldn't find relevant information in this workspace's documents.";
  for (const piece of answer.match(/.{1,6}/gs)) {
    if (closed) return;
    ev("token", { text: piece });
    await sleep(35);
  }
  const citations = docs.slice(0, 2).map((d, i) => ({ marker: i + 1, chunkId: chunks.get(d.id)?.[i]?.id ?? null, documentId: d.id, documentName: d.name, pageNumber: i + 3, sectionHeading: i === 0 ? "Financial highlights" : null, excerpt: chunks.get(d.id)?.[i]?.content ?? "", retrievalScore: 0.0325 - i * 0.004, rerankScore: 0.91 - i * 0.2 }));
  ev("citations", { citations });
  const am = { id: randomUUID(), role: "ASSISTANT", content: answer, status: "COMPLETED", citations, metadata: {}, createdAt: now() };
  conv.messages.push(am);
  conv.updatedAt = now();
  if (conv.title === "New conversation" && question) conv.title = question.slice(0, 60);
  ev("done", { message: am });
  res.end();
}

// ---------------------------------------------------------------- router
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname.replace(/^\/api\/v1/, "");
  const seg = p.split("/").filter(Boolean);
  const M = req.method;
  console.log(M, url.pathname + url.search);
  await sleep(120); // simulate latency

  // ---- auth (anonymous)
  if (M === "POST" && p === "/auth/login") {
    const b = await json(req);
    const u = [...users.values()].find((x) => x.email === b.email && x.password === b.password);
    return u ? issue(res, u) : problem(res, 401, "Bad credentials");
  }
  if (M === "POST" && p === "/auth/register") {
    const b = await json(req);
    if (!b.password || b.password.length < 8) return problem(res, 400, "Validation failed", { errors: { password: "must be at least 8 characters" } });
    if ([...users.values()].some((x) => x.email === b.email)) return problem(res, 409, "Email already registered", { errors: { email: "Already in use" } });
    return issue(res, addUser(b.email, b.password, b.displayName), 201);
  }
  if (M === "POST" && p === "/auth/refresh") {
    const rt = cookie(req, "haierag_refresh");
    const uid = rt && refresh.get(rt);
    if (!uid) return problem(res, 401, "No valid refresh token");
    refresh.delete(rt);
    return issue(res, users.get(uid));
  }
  if (M === "POST" && p === "/auth/logout") {
    const rt = cookie(req, "haierag_refresh");
    if (rt) refresh.delete(rt);
    return send(res, 204, null, undefined, { "set-cookie": "haierag_refresh=; Path=/api/v1/auth; HttpOnly; Max-Age=0" });
  }

  // ---- authenticated
  const token = (req.headers.authorization || "").replace(/^Bearer /, "");
  const user = users.get(tokens.get(token));
  if (!user) return problem(res, 401, "Unauthorized");

  if (p === "/auth/me") {
    if (M === "PUT") user.displayName = (await json(req)).displayName ?? user.displayName;
    return send(res, 200, publicUser(user));
  }

  if (p === "/system/health") {
    return send(res, 200, { backend: "UP", database: "UP", redis: "UP", storage: "UP", aiService: { status: "degraded", components: {
      ollama: { status: "ok", detail: "http://host.docker.internal:11434" }, llm: { status: "ok", detail: "qwen3:8b loaded" },
      embedding: { status: "ok", detail: "bge-m3 (1024 dims)" }, reranker: { status: "degraded", detail: "Not loaded (idle unload); loads on first use" },
      postgres: { status: "ok" }, redis: { status: "ok" }, storage: { status: "ok" } } } });
  }
  if (p === "/admin/users") return user.systemRole === "ADMIN" ? send(res, 200, [...users.values()].map(publicUser)) : problem(res, 403, "Admins only");
  if (p === "/admin/jobs") {
    if (user.systemRole !== "ADMIN") return problem(res, 403, "Admins only");
    const st = url.searchParams.get("status");
    return send(res, 200, [...documents.values()].filter((d) => !st || d.job.status === st).map((d) => ({ ...d.job, documentId: d.id, documentName: d.name, workspaceId: d.workspaceId, errorMessage: d.errorMessage, createdAt: d.createdAt })));
  }

  // workspaces
  if (seg[0] === "workspaces") {
    if (seg.length === 1) {
      if (M === "GET") return send(res, 200, [...workspaces.values()].filter((w) => w.members.has(user.id)).map((w) => wsView(w, user.id)));
      if (M === "POST") {
        const b = await json(req);
        if (!b.name) return problem(res, 400, "Name is required");
        const w = { id: randomUUID(), name: b.name, description: b.description ?? null, createdAt: now(), updatedAt: now(), members: new Map([[user.id, { role: "OWNER", joinedAt: now() }]]) };
        workspaces.set(w.id, w);
        log(w.id, user, "WORKSPACE_CREATED", "workspace", w.id, { name: w.name });
        return send(res, 201, wsView(w, user.id));
      }
    }
    const w = access(res, user, seg[1], M === "GET" || seg[2] === "documents" || seg[2] === "collections" ? "VIEWER" : "OWNER");
    if (!w) return;
    if (seg.length === 2) {
      if (M === "GET") return send(res, 200, wsView(w, user.id));
      if (M === "PUT") { const b = await json(req); Object.assign(w, { name: b.name, description: b.description ?? null, updatedAt: now() }); return send(res, 200, wsView(w, user.id)); }
      if (M === "DELETE") { workspaces.delete(w.id); return send(res, 204); }
    }
    if (seg[2] === "stats") {
      const docs = [...documents.values()].filter((d) => d.workspaceId === w.id);
      const by = { UPLOADED: 0, QUEUED: 0, PROCESSING: 0, COMPLETED: 0, FAILED: 0 };
      docs.forEach((d) => by[d.status]++);
      return send(res, 200, { documents: docs.length, collections: [...collections.values()].filter((c) => c.workspaceId === w.id).length, chunks: docs.reduce((s, d) => s + d.chunkCount, 0), conversations: [...conversations.values()].filter((c) => c.workspaceId === w.id).length, documentsByStatus: by });
    }
    if (seg[2] === "activity") return send(res, 200, activity.filter((a) => a.wsId === w.id).slice(0, 50).map(({ wsId: _w, ...a }) => a));
    if (seg[2] === "members") {
      const view = (uid, m) => ({ userId: uid, email: users.get(uid).email, displayName: users.get(uid).displayName, role: m.role, joinedAt: m.joinedAt });
      if (seg.length === 3 && M === "GET") return send(res, 200, [...w.members].map(([uid, m]) => view(uid, m)));
      if (seg.length === 3 && M === "POST") {
        const b = await json(req);
        const u = [...users.values()].find((x) => x.email === b.email);
        if (!u) return problem(res, 404, `No user with email ${b.email}`);
        if (w.members.has(u.id)) return problem(res, 409, "Already a member");
        w.members.set(u.id, { role: b.role, joinedAt: now() });
        return send(res, 201, view(u.id, w.members.get(u.id)));
      }
      const m = w.members.get(seg[3]);
      if (!m) return problem(res, 404, "Member not found");
      const owners = [...w.members.values()].filter((x) => x.role === "OWNER").length;
      if (M === "PUT") { const b = await json(req); if (m.role === "OWNER" && b.role !== "OWNER" && owners === 1) return problem(res, 409, "The last owner cannot be demoted"); m.role = b.role; return send(res, 200, view(seg[3], m)); }
      if (M === "DELETE") { if (m.role === "OWNER" && owners === 1) return problem(res, 409, "The last owner cannot be removed"); w.members.delete(seg[3]); return send(res, 204); }
    }
    if (seg[2] === "collections") {
      if (M === "GET") return send(res, 200, [...collections.values()].filter((c) => c.workspaceId === w.id).map(colView));
      const b = await json(req);
      const c = { id: randomUUID(), workspaceId: w.id, name: b.name, description: b.description ?? null, createdAt: now(), updatedAt: now() };
      collections.set(c.id, c);
      log(w.id, user, "COLLECTION_CREATED", "collection", c.id, { name: c.name });
      return send(res, 201, colView(c));
    }
    if (seg[2] === "documents") {
      if (M === "GET") {
        const { collectionId, status, q } = Object.fromEntries(url.searchParams);
        return send(res, 200, [...documents.values()].filter((d) => d.workspaceId === w.id && (!collectionId || d.collectionId === collectionId) && (!status || d.status === status) && (!q || d.name.toLowerCase().includes(q.toLowerCase()))).reverse().map(docView));
      }
      if (M === "POST") {
        const body = await readBody(req);
        const head = body.subarray(0, 4096).toString("latin1");
        const name = /filename="([^"]+)"/.exec(head)?.[1] ?? "upload.bin";
        const collectionId = /name="collectionId"\r\n\r\n([0-9a-f-]{36})/.exec(body.toString("latin1"))?.[1] ?? null;
        if (body.length > 50 * 1024 * 1024) return problem(res, 413, "File exceeds the 50 MB limit");
        if (name.toLowerCase().includes("badmagic")) return problem(res, 415, "File content does not match its .pdf extension");
        const d = makeDoc(w.id, name, body.length, collectionId, user.id);
        log(w.id, user, "DOCUMENT_UPLOADED", "document", d.id, { name });
        return send(res, 202, docView(d));
      }
    }
  }

  if (seg[0] === "collections" && seg[1]) {
    const c = collections.get(seg[1]);
    if (!c || !access(res, user, c.workspaceId, "MEMBER")) return c ? undefined : problem(res, 404, "Collection not found");
    if (M === "PUT") { const b = await json(req); Object.assign(c, { name: b.name, description: b.description ?? null, updatedAt: now() }); return send(res, 200, colView(c)); }
    if (M === "DELETE") { collections.delete(c.id); documents.forEach((d) => d.collectionId === c.id && (d.collectionId = null)); return send(res, 204); }
  }

  if (seg[0] === "documents" && seg[1]) {
    const d = documents.get(seg[1]);
    if (!d) return problem(res, 404, "Document not found");
    if (!access(res, user, d.workspaceId, M === "GET" ? "VIEWER" : "MEMBER")) return;
    if (seg.length === 2) {
      if (M === "GET") return send(res, 200, docView(d));
      if (M === "PATCH") { const b = await json(req); if ("collectionId" in b) d.collectionId = b.collectionId; if (b.name) d.name = b.name; d.updatedAt = now(); return send(res, 200, docView(d)); }
      if (M === "DELETE") { documents.delete(d.id); chunks.delete(d.id); log(d.workspaceId, user, "DOCUMENT_DELETED", "document", d.id, { name: d.name }); return send(res, 204); }
    }
    if (seg[2] === "status") return send(res, 200, { documentId: d.id, status: d.status, errorMessage: d.errorMessage, job: d.job });
    if (seg[2] === "chunks") {
      const page = Number(url.searchParams.get("page") || 0), size = Number(url.searchParams.get("size") || 50);
      const all = chunks.get(d.id) ?? [];
      return send(res, 200, { content: all.slice(page * size, page * size + size), page, size, totalElements: all.length, totalPages: Math.ceil(all.length / size) });
    }
    if (seg[2] === "download") {
      res.writeHead(200, { "content-type": "text/plain", "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(d.originalFilename)}` });
      return res.end(`Mock content of ${d.originalFilename}\n`);
    }
    if (seg[2] === "reprocess") { Object.assign(d, { status: "QUEUED", errorMessage: null }); d.job = { id: randomUUID(), status: "QUEUED", stage: null, attempts: d.job.attempts + 1, startedAt: null, finishedAt: null, metrics: {} }; simulateIngest(d); return send(res, 202, docView(d)); }
  }

  if (seg[0] === "conversations") {
    const view = ({ messages: _m, ownerId: _o, ...c }) => c;
    if (seg.length === 1 && M === "GET") return send(res, 200, [...conversations.values()].filter((c) => c.ownerId === user.id && c.workspaceId === url.searchParams.get("workspaceId")).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(view));
    if (seg.length === 1 && M === "POST") {
      const b = await json(req);
      if (!access(res, user, b.workspaceId)) return;
      const c = { id: randomUUID(), ownerId: user.id, workspaceId: b.workspaceId, title: b.title || "New conversation", scopeType: b.scopeType ?? "WORKSPACE", collectionId: b.collectionId ?? null, documentIds: b.documentIds ?? [], createdAt: now(), updatedAt: now(), messages: [] };
      conversations.set(c.id, c);
      return send(res, 201, view(c));
    }
    const c = conversations.get(seg[1]);
    if (!c || c.ownerId !== user.id) return problem(res, 404, "Conversation not found");
    if (seg.length === 2) {
      if (M === "GET") return send(res, 200, { ...view(c), messages: c.messages });
      if (M === "PATCH") { c.title = (await json(req)).title; c.updatedAt = now(); return send(res, 200, view(c)); }
      if (M === "DELETE") { conversations.delete(c.id); return send(res, 204); }
    }
    if (seg[2] === "messages" && M === "POST") {
      const b = await json(req);
      if (b.content?.toLowerCase().includes("503")) return problem(res, 503, "AI service unavailable");
      return streamAnswer(req, res, c, user, b.content ?? "");
    }
    if (seg[2] === "regenerate" && M === "POST") {
      const i = c.messages.map((m) => m.role).lastIndexOf("ASSISTANT");
      if (i >= 0) c.messages.splice(i, 1);
      return streamAnswer(req, res, c, user, null);
    }
  }

  problem(res, 404, `No mock route for ${M} ${url.pathname}`);
});

server.listen(PORT, () => console.log(`HaieRag mock backend on http://localhost:${PORT} (login admin@haierag.local / password123)`));
