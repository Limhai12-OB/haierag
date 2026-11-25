import { ApiError, authFetch, readProblem } from "@/lib/api-client";
import { readSseStream } from "@/lib/sse";
import type { ChatStreamEvent } from "@/types/api";

export type ChatStreamRequest =
  { kind: "message"; conversationId: string; content: string } | { kind: "regenerate"; conversationId: string };

const KNOWN_EVENTS = new Set(["user_message", "meta", "token", "citations", "done", "error"]);

/**
 * POSTs to the chat endpoint and invokes `onEvent` for each SSE event.
 * Uses fetch + ReadableStream (EventSource cannot POST or send Authorization).
 * Throws ApiError for pre-stream failures (problem+json); stream-level failures arrive as `error` events.
 */
export async function streamChat(
  req: ChatStreamRequest,
  onEvent: (ev: ChatStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const path =
    req.kind === "message"
      ? `/conversations/${req.conversationId}/messages`
      : `/conversations/${req.conversationId}/regenerate`;
  const res = await authFetch(path, {
    method: "POST",
    headers: {
      Accept: "text/event-stream",
      ...(req.kind === "message" ? { "Content-Type": "application/json" } : {}),
    },
    body: req.kind === "message" ? JSON.stringify({ content: req.content }) : undefined,
    signal,
    cache: "no-store",
  });
  if (!res.ok) throw new ApiError(res.status, await readProblem(res));
  if (!res.body) throw new ApiError(res.status, { detail: "The server returned an empty stream." });

  let terminal = false;
  for await (const raw of readSseStream(res.body, signal)) {
    if (!KNOWN_EVENTS.has(raw.event)) continue;
    let data: unknown;
    try {
      data = JSON.parse(raw.data);
    } catch {
      continue; // ignore malformed payloads rather than killing the stream
    }
    const ev = { event: raw.event, data } as ChatStreamEvent;
    if (ev.event === "done" || ev.event === "error") terminal = true;
    onEvent(ev);
    if (terminal) break;
  }
  if (!terminal && !signal?.aborted) {
    onEvent({
      event: "error",
      data: { code: "STREAM_INTERRUPTED", message: "The connection closed before the answer finished." },
    });
  }
}
