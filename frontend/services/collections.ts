import { api } from "@/lib/api-client";
import type { Collection, CollectionRequest } from "@/types/api";

export const listCollections = (workspaceId: string) => api<Collection[]>(`/workspaces/${workspaceId}/collections`);
export const createCollection = (workspaceId: string, body: CollectionRequest) =>
  api<Collection>(`/workspaces/${workspaceId}/collections`, { method: "POST", body });
export const updateCollection = (id: string, body: CollectionRequest) =>
  api<Collection>(`/collections/${id}`, { method: "PUT", body });
export const deleteCollection = (id: string) => api<void>(`/collections/${id}`, { method: "DELETE" });
