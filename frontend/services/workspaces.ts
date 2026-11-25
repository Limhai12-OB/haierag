import { api } from "@/lib/api-client";
import type { Activity, Member, Role, Workspace, WorkspaceRequest, WorkspaceStats } from "@/types/api";

export const listWorkspaces = () => api<Workspace[]>("/workspaces");
export const getWorkspace = (id: string) => api<Workspace>(`/workspaces/${id}`);
export const createWorkspace = (body: WorkspaceRequest) => api<Workspace>("/workspaces", { method: "POST", body });
export const updateWorkspace = (id: string, body: WorkspaceRequest) =>
  api<Workspace>(`/workspaces/${id}`, { method: "PUT", body });
export const deleteWorkspace = (id: string) => api<void>(`/workspaces/${id}`, { method: "DELETE" });

export const listMembers = (id: string) => api<Member[]>(`/workspaces/${id}/members`);
export const addMember = (id: string, body: { email: string; role: Role }) =>
  api<Member>(`/workspaces/${id}/members`, { method: "POST", body });
export const updateMember = (id: string, userId: string, role: Role) =>
  api<Member>(`/workspaces/${id}/members/${userId}`, { method: "PUT", body: { role } });
export const removeMember = (id: string, userId: string) =>
  api<void>(`/workspaces/${id}/members/${userId}`, { method: "DELETE" });

export const getWorkspaceStats = (id: string) => api<WorkspaceStats>(`/workspaces/${id}/stats`);
export const getWorkspaceActivity = (id: string) => api<Activity[]>(`/workspaces/${id}/activity`);
