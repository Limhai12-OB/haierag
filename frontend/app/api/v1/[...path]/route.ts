/**
 * Same-origin reverse proxy: /api/v1/* → ${BACKEND_URL}/api/v1/*
 *
 * Why a route handler instead of a next.config rewrite:
 *  1. `BACKEND_URL` is read per request at *runtime*, so one Docker image works in any
 *     environment (rewrites are serialized into the build output and frozen at build time).
 *  2. The upstream body is returned as a ReadableStream without buffering, so the chat SSE
 *     stream (text/event-stream) reaches the browser token by token.
 *  3. Set-Cookie headers (the httpOnly refresh cookie) are forwarded individually.
 */
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
]);

function backendBase(): string {
  return (process.env.BACKEND_URL || "http://localhost:8080").replace(/\/+$/, "");
}

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { path } = await ctx.params;
  const target = `${backendBase()}/api/v1/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`;

  const headers = new Headers();
  req.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    // `expect: 100-continue` (sent by curl for large uploads) is rejected by Node's fetch.
    if (HOP_BY_HOP.has(k) || k === "content-length" || k === "accept-encoding" || k === "expect") return;
    headers.set(key, value);
  });
  // Ask for identity encoding so streamed responses are never held back by a compressor.
  headers.set("accept-encoding", "identity");
  const host = req.headers.get("host");
  if (host) headers.set("x-forwarded-host", host);
  headers.set("x-forwarded-proto", req.nextUrl.protocol.replace(":", ""));

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body: hasBody ? req.body : undefined,
      // Required by Node's fetch when streaming a request body (uploads are piped, not buffered).
      ...(hasBody ? { duplex: "half" } : {}),
      redirect: "manual",
      cache: "no-store",
      signal: req.signal, // client disconnect (e.g. "stop generating") aborts the upstream request
    } as RequestInit);
  } catch (err) {
    if (req.signal.aborted) return new Response(null, { status: 499 });
    console.error(`[api-proxy] ${req.method} ${target} failed:`, err);
    return Response.json(
      {
        type: "about:blank",
        title: "Bad Gateway",
        status: 502,
        detail: "The HaieRag backend is unreachable. Check that it is running.",
      },
      { status: 502, headers: { "content-type": "application/problem+json" } },
    );
  }

  const resHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    // fetch() already decoded the body, so length/encoding no longer apply; cookies are handled below.
    if (HOP_BY_HOP.has(k) || k === "content-length" || k === "content-encoding" || k === "set-cookie") return;
    resHeaders.set(key, value);
  });
  for (const cookie of upstream.headers.getSetCookie()) resHeaders.append("set-cookie", cookie);

  if ((upstream.headers.get("content-type") ?? "").includes("text/event-stream")) {
    // no-transform stops compression middleware from buffering; X-Accel-Buffering covers nginx.
    resHeaders.set("cache-control", "no-cache, no-transform");
    resHeaders.set("x-accel-buffering", "no");
  }

  const nullBody = upstream.status === 204 || upstream.status === 304 || req.method === "HEAD";
  return new Response(nullBody ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: resHeaders,
  });
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE, proxy as HEAD, proxy as OPTIONS };
