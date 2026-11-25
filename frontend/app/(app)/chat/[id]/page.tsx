"use client";

import { use } from "react";
import { ChatView } from "@/features/chat/chat-view";
import { WorkspaceBoundary } from "@/features/shell/workspace-boundary";

export default function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <WorkspaceBoundary>{(ws) => <ChatView workspace={ws} conversationId={id} />}</WorkspaceBoundary>;
}
