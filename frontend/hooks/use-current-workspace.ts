"use client";

import { useQuery } from "@tanstack/react-query";
import { qk } from "@/lib/query-keys";
import { useSessionStore } from "@/lib/session-store";
import { listWorkspaces } from "@/services/workspaces";
import type { Role, Workspace } from "@/types/api";

export function useWorkspaces() {
  return useQuery({ queryKey: qk.workspaces, queryFn: listWorkspaces });
}

/** The selected workspace (falls back to the first one when the stored id is stale). */
export function useCurrentWorkspace() {
  const query = useWorkspaces();
  const storedId = useSessionStore((s) => s.currentWorkspaceId);
  const workspaces = query.data ?? [];
  const workspace: Workspace | null = workspaces.find((w) => w.id === storedId) ?? workspaces[0] ?? null;
  return { ...query, workspace, workspaces };
}

const RANK: Record<Role, number> = { VIEWER: 0, MEMBER: 1, OWNER: 2 };

export function hasRole(workspace: Pick<Workspace, "role"> | null | undefined, min: Role): boolean {
  return !!workspace && RANK[workspace.role] >= RANK[min];
}
