import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetRefreshForTests } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import type { ChatStreamEvent } from "@/types/api";
import { streamChat } from "./chat-stream";

function sseResponse(chunks: string[]) {
  const enc = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        chunks.forEach((ch) => c.enqueue(enc.encode(ch)));
        c.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
}

describe("streamChat", () => {
  beforeEach(() => {
    __resetRefreshForTests();
    useAuthStore.setState({ status: "authenticated", accessToken: "tok", user: null });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("POSTs the message and emits typed events from arbitrarily split chunks", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        'event: user_message\ndata: {"id":"u1","role":"USER","content":"hi"}\n',
        '\nevent: meta\ndata: {"retrieval":{"candidates":4,"passages":2,"timingsMs":{"total":12}}}\n\nevent: tok',
        'en\ndata: {"text":"Hel"}\n\nevent: token\r\ndata: {"text":"lo [1]"}\r\n\r\n',
        'event: citations\ndata: {"citations":[]}\n\nevent: done\ndata: {"message":{"id":"a1"}}\n\n',
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);
    const events: ChatStreamEvent[] = [];
    await streamChat({ kind: "message", conversationId: "c1", content: "hi" }, (e) => events.push(e));

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/v1/conversations/c1/messages");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ content: "hi" }));
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer tok");
    expect(events.map((e) => e.event)).toEqual(["user_message", "meta", "token", "token", "citations", "done"]);
    const text = events.flatMap((e) => (e.event === "token" ? [e.data.text] : [])).join("");
    expect(text).toBe("Hello [1]");
  });

  it("emits an error event when the stream ends without done/error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse(['event: token\ndata: {"text":"partial"}\n\n'])));
    const events: ChatStreamEvent[] = [];
    await streamChat({ kind: "regenerate", conversationId: "c1" }, (e) => events.push(e));
    expect(events.at(-1)).toMatchObject({ event: "error", data: { code: "STREAM_INTERRUPTED" } });
  });

  it("throws ApiError with problem detail when the request fails before streaming", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ status: 503, detail: "Model unavailable: run ollama pull" }), {
          status: 503,
          headers: { "content-type": "application/problem+json" },
        }),
      ),
    );
    await expect(streamChat({ kind: "message", conversationId: "c1", content: "q" }, () => {})).rejects.toMatchObject({
      status: 503,
      message: "Model unavailable: run ollama pull",
    });
  });
});
