"use client";

import { ChatView } from "@/features/chat/chat-view";
import { WorkspaceBoundary } from "@/features/shell/workspace-boundary";

export default function ChatPage() {
  return <WorkspaceBoundary>{(ws) => <ChatView key={ws.id} workspace={ws} conversationId={null} />}</WorkspaceBoundary>;
}
