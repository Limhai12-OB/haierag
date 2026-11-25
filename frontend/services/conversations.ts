import { api } from "@/lib/api-client";
import type { Conversation, ConversationDetail, CreateConversationRequest } from "@/types/api";

export const listConversations = (workspaceId: string) =>
  api<Conversation[]>(`/conversations?workspaceId=${encodeURIComponent(workspaceId)}`);
export const getConversation = (id: string) => api<ConversationDetail>(`/conversations/${id}`);
export const createConversation = (body: CreateConversationRequest) =>
  api<Conversation>("/conversations", { method: "POST", body });
export const renameConversation = (id: string, title: string) =>
  api<Conversation>(`/conversations/${id}`, { method: "PATCH", body: { title } });
export const deleteConversation = (id: string) => api<void>(`/conversations/${id}`, { method: "DELETE" });
