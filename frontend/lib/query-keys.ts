import type { DocumentFilters } from "@/services/documents";

export const qk = {
  me: ["me"] as const,
  workspaces: ["workspaces"] as const,
  workspace: (id: string) => ["workspaces", id] as const,
  stats: (id: string) => ["workspaces", id, "stats"] as const,
  activity: (id: string) => ["workspaces", id, "activity"] as const,
  members: (id: string) => ["workspaces", id, "members"] as const,
  collections: (wsId: string) => ["workspaces", wsId, "collections"] as const,
  documents: (wsId: string, filters?: DocumentFilters) =>
    filters ? (["workspaces", wsId, "documents", filters] as const) : (["workspaces", wsId, "documents"] as const),
  document: (id: string) => ["documents", id] as const,
  documentStatus: (id: string) => ["documents", id, "status"] as const,
  chunks: (id: string, page: number) => ["documents", id, "chunks", page] as const,
  conversations: (wsId: string) => ["conversations", wsId] as const,
  conversation: (id: string) => ["conversation", id] as const,
  health: ["system", "health"] as const,
  adminUsers: ["admin", "users"] as const,
  adminJobs: (status: string | null) => ["admin", "jobs", status] as const,
};
