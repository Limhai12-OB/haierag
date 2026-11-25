import { describe, expect, it } from "vitest";
import { readSseStream, SseParser, type SseEvent } from "./sse";

function feedAll(parts: string[]): SseEvent[] {
  const p = new SseParser();
  const out: SseEvent[] = [];
  for (const part of parts) out.push(...p.feed(part));
  out.push(...p.flush());
  return out;
}

const STREAM =
  'event: meta\ndata: {"retrieval":{"candidates":3}}\n\n' +
  'event: token\ndata: {"text":"Hel"}\n\n' +
  'event: token\ndata: {"text":"lo [1]"}\n\n' +
  'event: done\ndata: {"message":{"id":"m1"}}\n\n';

describe("SseParser", () => {
  it("parses complete events", () => {
    const events = feedAll([STREAM]);
    expect(events.map((e) => e.event)).toEqual(["meta", "token", "token", "done"]);
    expect(JSON.parse(events[2].data)).toEqual({ text: "lo [1]" });
  });

  it("gives identical results when the stream is split at every possible position", () => {
    const expected = feedAll([STREAM]);
    for (let i = 1; i < STREAM.length; i++) {
      expect(feedAll([STREAM.slice(0, i), STREAM.slice(i)])).toEqual(expected);
    }
  });

  it("handles one-character chunks", () => {
    expect(feedAll(STREAM.split(""))).toEqual(feedAll([STREAM]));
  });

  it("joins multi-line data with newlines", () => {
    const events = feedAll(["event: token\ndata: line one\ndata: line two\ndata:\ndata: line four\n\n"]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ event: "token", data: "line one\nline two\n\nline four" });
  });

  it("handles CRLF and lone CR line endings, including CRLF split across chunks", () => {
    const crlf = 'event: token\r\ndata: {"text":"a"}\r\n\r\nevent: done\r\ndata: {}\r\n\r\n';
    const expected = [
      { event: "token", data: '{"text":"a"}' },
      { event: "done", data: "{}" },
    ];
    expect(feedAll([crlf])).toEqual(expected);
    const cut = crlf.indexOf("\r\n") + 1; // between \r and \n
    expect(feedAll([crlf.slice(0, cut), crlf.slice(cut)])).toEqual(expected);
    expect(feedAll(["event: token\rdata: x\r\r"])).toEqual([{ event: "token", data: "x" }]);
  });

  it("ignores comments/heartbeats, strips only one leading space, defaults event name", () => {
    const events = feedAll([": keep-alive\n\ndata:  two spaces\n\n"]);
    expect(events).toEqual([{ event: "message", data: " two spaces" }]);
  });

  it("does not dispatch events without data and resets the event name", () => {
    const events = feedAll(["event: ping\n\ndata: x\n\n"]);
    expect(events).toEqual([{ event: "message", data: "x" }]);
  });

  it("records id and retry fields", () => {
    expect(feedAll(["id: 7\nretry: 1500\ndata: y\n\n"])).toEqual([{ event: "message", data: "y", id: "7", retry: 1500 }]);
  });

  it("flushes a trailing event missing its final blank line", () => {
    expect(feedAll(["event: done\ndata: {}"])).toEqual([{ event: "done", data: "{}" }]);
  });

  it("strips a leading BOM", () => {
    expect(feedAll(["﻿data: z\n\n"])).toEqual([{ event: "message", data: "z" }]);
  });
});

describe("readSseStream", () => {
  it("decodes multi-byte UTF-8 split across byte chunks", async () => {
    const bytes = new TextEncoder().encode('event: token\ndata: {"text":"សួស្តី ✓"}\n\n');
    const chunks = [bytes.slice(0, 25), bytes.slice(25, 27), bytes.slice(27)];
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        chunks.forEach((ch) => c.enqueue(ch));
        c.close();
      },
    });
    const events: SseEvent[] = [];
    for await (const ev of readSseStream(body)) events.push(ev);
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0].data).text).toBe("សួស្តី ✓");
  });
});
