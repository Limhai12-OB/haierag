"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "@/lib/api-client";
import { qk } from "@/lib/query-keys";
import { streamChat, type ChatStreamRequest } from "@/services/chat-stream";
import type { Citation, ConversationDetail, Message, RetrievalMeta } from "@/types/api";

export type RetrievalInfo = RetrievalMeta["retrieval"];

export type DraftAnswer = {
  content: string;
  citations: Citation[];
  meta: RetrievalInfo | null;
  state: "streaming" | "error" | "stopped";
  error: { code: string; message: string } | null;
};

export type PendingTurn = {
  /** Optimistic (then persisted) user message; absent for regenerate. */
  user: Message | null;
  answer: DraftAnswer;
  /** Regenerate: hide the last persisted assistant message while the replacement streams. */
  replacesLast: boolean;
};

const emptyDraft = (): DraftAnswer => ({ content: "", citations: [], meta: null, state: "streaming", error: null });

/**
 * Drives one conversation's streaming turn. Persisted messages stay in the TanStack Query cache;
 * the in-progress turn lives here and is merged into the cache when `done` arrives.
 */
export function useChatStream(conversationId: string, workspaceId: string) {
  const qc = useQueryClient();
  const [pending, setPending] = useState<PendingTurn | null>(null);
  /** Retrieval meta for messages completed in this session, keyed by message id. */
  const [metaById, setMetaById] = useState<Record<string, RetrievalInfo>>({});
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const run = useCallback(
    async (req: ChatStreamRequest, optimisticUser: Message | null) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      let persistedUser: Message | null = null;
      let meta: RetrievalInfo | null = null;
      const key = qk.conversation(conversationId);
      const replacesLast = req.kind === "regenerate";
      // Ignore late updates from a run that has been superseded by a newer one.
      const setP: typeof setPending = (u) => {
        if (abortRef.current === controller) setPending(u);
      };
      const patchAnswer = (fn: (a: DraftAnswer) => Partial<DraftAnswer>) =>
        setP((p) => (p ? { ...p, answer: { ...p.answer, ...fn(p.answer) } } : p));
      // Once the user message is persisted (and committed to the cache) drop the optimistic copy.
      const dropUserIfPersisted = () => {
        if (persistedUser) setP((p) => (p ? { ...p, user: null } : p));
      };
      setP({ user: optimisticUser, answer: emptyDraft(), replacesLast });

      const commit = (assistant: Message | null) => {
        qc.setQueryData<ConversationDetail>(key, (old) => {
          if (!old) return old;
          let messages = old.messages;
          if (replacesLast) {
            const lastIdx = messages.map((m) => m.role).lastIndexOf("ASSISTANT");
            if (assistant && lastIdx >= 0) messages = messages.filter((_, i) => i !== lastIdx);
          }
          if (persistedUser && !messages.some((m) => m.id === persistedUser!.id))
            messages = [...messages, persistedUser];
          if (assistant) messages = [...messages.filter((m) => m.id !== assistant.id), assistant];
          return { ...old, messages };
        });
      };

      try {
        await streamChat(
          req,
          (ev) => {
            switch (ev.event) {
              case "user_message":
                persistedUser = ev.data;
                setP((p) => (p ? { ...p, user: ev.data } : p));
                break;
              case "meta":
                meta = ev.data.retrieval;
                patchAnswer(() => ({ meta: ev.data.retrieval }));
                break;
              case "token":
                patchAnswer((a) => ({ content: a.content + ev.data.text }));
                break;
              case "citations":
                patchAnswer(() => ({ citations: ev.data.citations }));
                break;
              case "done": {
                const msg = ev.data.message;
                if (meta) setMetaById((m) => ({ ...m, [msg.id]: meta! }));
                commit(msg);
                setP(null);
                break;
              }
              case "error":
                commit(null);
                patchAnswer(() => ({ state: "error", error: ev.data }));
                dropUserIfPersisted();
                break;
            }
          },
          controller.signal,
        );
      } catch (err) {
        if (controller.signal.aborted) {
          commit(null);
          patchAnswer(() => ({ state: "stopped" }));
          dropUserIfPersisted();
        } else {
          // Pre-stream failure (problem+json, network): nothing was persisted for this turn.
          patchAnswer(() => ({ state: "error", error: { code: "REQUEST_FAILED", message: errorMessage(err) } }));
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        qc.invalidateQueries({ queryKey: qk.conversations(workspaceId) });
      }
    },
    [conversationId, workspaceId, qc],
  );

  const send = useCallback(
    (content: string) => {
      const optimistic: Message = {
        id: `temp-${Date.now()}`,
        role: "USER",
        content,
        status: "COMPLETED",
        citations: [],
        metadata: {},
        createdAt: new Date().toISOString(),
      };
      return run({ kind: "message", conversationId, content }, optimistic);
    },
    [run, conversationId],
  );

  const regenerate = useCallback(() => run({ kind: "regenerate", conversationId }, null), [run, conversationId]);
  const stop = useCallback(() => abortRef.current?.abort(), []);
  const dismiss = useCallback(() => setPending(null), []);

  return {
    pending,
    metaById,
    streaming: pending?.answer.state === "streaming",
    send,
    regenerate,
    stop,
    dismiss,
  };
}
