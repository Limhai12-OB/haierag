"use client";

import { useQuery } from "@tanstack/react-query";
import { MessagesSquare, PanelLeft, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useCurrentWorkspace } from "@/hooks/use-current-workspace";
import { qk } from "@/lib/query-keys";
import { useSessionStore } from "@/lib/session-store";
import { getConversation } from "@/services/conversations";
import type { Workspace } from "@/types/api";
import { ChatThread } from "./chat-thread";
import { ConversationSidebar } from "./conversation-sidebar";
import { NewConversationDialog } from "./new-conversation-dialog";

export function ChatView({ workspace, conversationId }: { workspace: Workspace; conversationId: string | null }) {
  const [newOpen, setNewOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const { workspaces } = useCurrentWorkspace();
  const setCurrent = useSessionStore((s) => s.setCurrentWorkspaceId);

  // Opening a conversation link from another workspace switches the workspace to match.
  const detail = useQuery({
    queryKey: qk.conversation(conversationId ?? ""),
    queryFn: () => getConversation(conversationId!),
    enabled: !!conversationId,
    staleTime: 60_000,
  });
  const convWorkspace = detail.data?.workspaceId;
  useEffect(() => {
    if (convWorkspace && convWorkspace !== workspace.id && workspaces.some((w) => w.id === convWorkspace)) {
      setCurrent(convWorkspace);
    }
  }, [convWorkspace, workspace.id, workspaces, setCurrent]);

  const mobileListButton = (
    <Button
      variant="ghost"
      size="icon-sm"
      className="md:hidden"
      aria-label="Show conversations"
      onClick={() => setListOpen(true)}
    >
      <PanelLeft aria-hidden />
    </Button>
  );

  return (
    <div className="flex h-[calc(100svh-3rem)] min-h-0 md:h-svh">
      <aside className="hidden w-64 shrink-0 border-r md:block">
        <ConversationSidebar workspaceId={workspace.id} activeId={conversationId} onNew={() => setNewOpen(true)} />
      </aside>
      <Sheet open={listOpen} onOpenChange={setListOpen}>
        <SheetContent side="left" className="w-72 p-0">
          <SheetTitle className="sr-only">Conversations</SheetTitle>
          <SheetDescription className="sr-only">Your conversations in this workspace</SheetDescription>
          <ConversationSidebar
            workspaceId={workspace.id}
            activeId={conversationId}
            onNew={() => {
              setListOpen(false);
              setNewOpen(true);
            }}
            onNavigate={() => setListOpen(false)}
          />
        </SheetContent>
      </Sheet>

      {conversationId ? (
        <ChatThread key={conversationId} conversationId={conversationId} headerLeft={mobileListButton} />
      ) : (
        <div className="flex flex-1 flex-col">
          <div className="p-2 md:hidden">{mobileListButton}</div>
          <div className="flex flex-1 items-center justify-center p-6">
            <EmptyState
              icon={MessagesSquare}
              title="Chat with your knowledge base"
              description="Start a conversation scoped to the whole workspace, one collection, or hand-picked documents."
              className="w-full max-w-lg"
              action={
                <Button onClick={() => setNewOpen(true)}>
                  <Plus aria-hidden /> New conversation
                </Button>
              }
            />
          </div>
        </div>
      )}
      <NewConversationDialog workspaceId={workspace.id} open={newOpen} onOpenChange={setNewOpen} />
    </div>
  );
}
