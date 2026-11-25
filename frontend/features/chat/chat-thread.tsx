"use client";

import { useQuery } from "@tanstack/react-query";
import { FileQuestion, MessageSquareText } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { EmptyState, ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api-client";
import { qk } from "@/lib/query-keys";
import { listCollections } from "@/services/collections";
import { getConversation } from "@/services/conversations";
import type { Citation, ConversationDetail, Message } from "@/types/api";
import { ChatComposer } from "./chat-composer";
import { AssistantMessage, retrievalFromMetadata, UserMessage } from "./message-item";
import { SourcePanel } from "./source-panel";
import { useChatStream } from "./use-chat-stream";

function ScopeLabel({ detail }: { detail: ConversationDetail }) {
  const collections = useQuery({
    queryKey: qk.collections(detail.workspaceId),
    queryFn: () => listCollections(detail.workspaceId),
    enabled: detail.scopeType === "COLLECTION",
  });
  if (detail.scopeType === "COLLECTION") {
    const name = collections.data?.find((c) => c.id === detail.collectionId)?.name;
    return <>Collection: {name ?? "…"}</>;
  }
  if (detail.scopeType === "DOCUMENTS") {
    const n = detail.documentIds.length;
    return (
      <>
        {n} selected document{n === 1 ? "" : "s"}
      </>
    );
  }
  return <>Whole workspace</>;
}

export function ChatThread({
  conversationId,
  headerLeft,
}: {
  conversationId: string;
  /** Slot for the mobile "conversations" button. */
  headerLeft?: React.ReactNode;
}) {
  const detail = useQuery({
    queryKey: qk.conversation(conversationId),
    queryFn: () => getConversation(conversationId),
    staleTime: 60_000,
  });
  const workspaceId = detail.data?.workspaceId ?? "";
  const chat = useChatStream(conversationId, workspaceId);
  const [selected, setSelected] = useState<Citation | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const { pending } = chat;
  const messages: Message[] = useMemo(() => {
    const base = detail.data?.messages ?? [];
    if (pending?.replacesLast && pending.answer.state === "streaming") {
      const lastIdx = base.map((m) => m.role).lastIndexOf("ASSISTANT");
      return lastIdx >= 0 ? base.filter((_, i) => i !== lastIdx) : base;
    }
    return base;
  }, [detail.data?.messages, pending]);

  const lastAssistantId = [...messages].reverse().find((m) => m.role === "ASSISTANT")?.id;
  const lastMessage = messages[messages.length - 1];

  // Keep the view pinned to the bottom while streaming unless the user scrolled up.
  const onScroll = () => {
    const el = scrollRef.current;
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, pending]);

  useEffect(() => {
    stickToBottom.current = true;
  }, [conversationId]);

  const closePanel = useCallback(() => setSelected(null), []);
  const send = (text: string) => {
    stickToBottom.current = true;
    setSelected(null);
    void chat.send(text);
  };

  if (detail.isLoading) {
    return (
      <div className="flex flex-1 flex-col gap-4 p-6">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="ml-auto h-10 w-2/3" />
        <Skeleton className="h-24 w-3/4" />
      </div>
    );
  }
  if (detail.error) {
    const notFound = detail.error instanceof ApiError && (detail.error.status === 404 || detail.error.status === 403);
    return (
      <div className="flex flex-1 flex-col p-6">
        {headerLeft}
        {notFound ? (
          <EmptyState
            icon={FileQuestion}
            title="Conversation not found"
            description="It may have been deleted."
            action={
              <Button variant="outline" asChild>
                <Link href="/chat">Back to chat</Link>
              </Button>
            }
          />
        ) : (
          <ErrorState error={detail.error} title="Couldn't load conversation" onRetry={() => detail.refetch()} />
        )}
      </div>
    );
  }

  const d = detail.data!;
  const busy = chat.streaming;
  const canRegenerate = !busy && lastMessage?.role === "ASSISTANT";
  const pendingFailedBeforeStream =
    pending?.answer.state === "error" && pending.answer.error?.code === "REQUEST_FAILED";

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <section className="flex min-w-0 flex-1 flex-col" aria-label="Conversation">
        <header className="flex items-center gap-2 border-b px-4 py-2.5">
          {headerLeft}
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold">{d.title || "Untitled conversation"}</h1>
            <p className="truncate text-xs text-muted-foreground">
              Scope: <ScopeLabel detail={d} />
            </p>
          </div>
        </header>

        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="flex-1 overflow-y-auto"
          aria-live="polite"
          aria-relevant="additions"
        >
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
            {messages.length === 0 && !pending && (
              <EmptyState
                icon={MessageSquareText}
                title="Ask your first question"
                description="Answers cite the passages they're based on — click a citation to preview the source."
                className="border-none"
              />
            )}
            {messages.map((m) =>
              m.role === "USER" ? (
                <UserMessage key={m.id} content={m.content} />
              ) : (
                <AssistantMessage
                  key={m.id}
                  content={m.content}
                  citations={m.citations ?? []}
                  meta={chat.metaById[m.id] ?? retrievalFromMetadata(m.metadata)}
                  state={m.status === "FAILED" ? "failed" : "complete"}
                  activeMarker={selected && m.citations?.includes(selected) ? selected.marker : null}
                  onCitationClick={setSelected}
                  onRegenerate={
                    canRegenerate && m.id === lastAssistantId && !pending ? () => void chat.regenerate() : undefined
                  }
                />
              ),
            )}
            {pending?.user && (
              <UserMessage content={pending.user.content} pending={pending.user.id.startsWith("temp-")} />
            )}
            {pending && (
              <AssistantMessage
                content={pending.answer.content}
                citations={pending.answer.citations}
                meta={pending.answer.meta}
                state={pending.answer.state}
                error={pending.answer.error}
                activeMarker={selected && pending.answer.citations.includes(selected) ? selected.marker : null}
                onCitationClick={setSelected}
                onRetry={
                  pendingFailedBeforeStream && pending.user
                    ? () => {
                        const text = pending.user!.content;
                        chat.dismiss();
                        send(text);
                      }
                    : pending.answer.state !== "streaming" && !pending.user
                      ? () => void chat.regenerate()
                      : undefined
                }
              />
            )}
          </div>
        </div>

        <div className="border-t bg-background/95 p-3 sm:p-4">
          <ChatComposer onSend={send} onStop={chat.stop} streaming={busy} />
          <p className="mx-auto mt-1.5 max-w-3xl text-center text-[0.7rem] text-muted-foreground">
            Answers are generated from your documents and may be incomplete — check the cited sources.
          </p>
        </div>
      </section>
      {selected && <SourcePanel citation={selected} onClose={closePanel} />}
    </div>
  );
}
