/**
 * Incremental Server-Sent Events parser (WHATWG "event stream interpretation").
 *
 * - Accepts arbitrary text chunks: lines/fields/events may be split anywhere, including
 *   between the CR and LF of a CRLF pair.
 * - Line endings: LF, CRLF or a lone CR.
 * - Multiple `data:` lines are joined with "\n".
 * - Comment lines (starting with ":") are ignored; an optional single space after ":" is stripped.
 * - An event is dispatched on a blank line; `event` defaults to "message".
 */
export type SseEvent = { event: string; data: string; id?: string; retry?: number };

export class SseParser {
  private buffer = "";
  private pendingCR = false;
  private started = false;
  private eventType = "";
  private dataLines: string[] = [];
  private hasData = false;
  private lastId: string | undefined;
  private retry: number | undefined;

  /** Feed a decoded text chunk; returns the events completed by it. */
  feed(chunk: string): SseEvent[] {
    if (!this.started && chunk.length > 0) {
      this.started = true;
      if (chunk.charCodeAt(0) === 0xfeff) chunk = chunk.slice(1);
    }
    const out: SseEvent[] = [];
    let text = chunk;
    // A CR at the end of the previous chunk already terminated a line; swallow the LF of its CRLF pair.
    if (this.pendingCR) {
      this.pendingCR = false;
      if (text.startsWith("\n")) text = text.slice(1);
    }
    this.buffer += text;

    let start = 0;
    for (let i = 0; i < this.buffer.length; i++) {
      const ch = this.buffer[i];
      if (ch !== "\n" && ch !== "\r") continue;
      const line = this.buffer.slice(start, i);
      if (ch === "\r") {
        if (i + 1 < this.buffer.length) {
          if (this.buffer[i + 1] === "\n") i++;
        } else {
          this.pendingCR = true;
        }
      }
      start = i + 1;
      const ev = this.processLine(line);
      if (ev) out.push(ev);
    }
    this.buffer = this.buffer.slice(start);
    return out;
  }

  /** Call at end of stream. Per spec an unterminated trailing event is discarded,
   *  but we dispatch it if it carries data so a server that omits the final blank line still works. */
  flush(): SseEvent[] {
    const out: SseEvent[] = [];
    if (this.buffer.length > 0) {
      const ev = this.processLine(this.buffer);
      this.buffer = "";
      if (ev) out.push(ev);
    }
    const ev = this.dispatch();
    if (ev) out.push(ev);
    return out;
  }

  private processLine(line: string): SseEvent | null {
    if (line === "") return this.dispatch();
    if (line.startsWith(":")) return null;
    const colon = line.indexOf(":");
    let field: string;
    let value: string;
    if (colon === -1) {
      field = line;
      value = "";
    } else {
      field = line.slice(0, colon);
      value = line.slice(colon + 1);
      if (value.startsWith(" ")) value = value.slice(1);
    }
    switch (field) {
      case "event":
        this.eventType = value;
        break;
      case "data":
        this.dataLines.push(value);
        this.hasData = true;
        break;
      case "id":
        if (!value.includes("\0")) this.lastId = value;
        break;
      case "retry":
        if (/^\d+$/.test(value)) this.retry = Number(value);
        break;
      default:
        break; // unknown fields are ignored
    }
    return null;
  }

  private dispatch(): SseEvent | null {
    if (!this.hasData) {
      this.eventType = "";
      return null;
    }
    const ev: SseEvent = {
      event: this.eventType || "message",
      data: this.dataLines.join("\n"),
    };
    if (this.lastId !== undefined) ev.id = this.lastId;
    if (this.retry !== undefined) ev.retry = this.retry;
    this.eventType = "";
    this.dataLines = [];
    this.hasData = false;
    return ev;
  }
}

/** Reads a byte stream and yields parsed SSE events. */
export async function* readSseStream(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  const parser = new SseParser();
  try {
    while (true) {
      if (signal?.aborted) return;
      const { value, done } = await reader.read();
      if (done) break;
      // stream: true keeps multi-byte UTF-8 sequences split across chunks intact.
      for (const ev of parser.feed(decoder.decode(value, { stream: true }))) yield ev;
    }
    const tail = decoder.decode();
    if (tail) for (const ev of parser.feed(tail)) yield ev;
    for (const ev of parser.flush()) yield ev;
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* already closed */
    }
    reader.releaseLock();
  }
}
