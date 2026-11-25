import { api } from "@/lib/api-client";
import type { AdminJob, SystemHealth, User } from "@/types/api";

export const getSystemHealth = () => api<SystemHealth>("/system/health");
export const listAdminUsers = () => api<User[]>("/admin/users");

/** The contract only says "recent processing jobs"; accept a bare array or a Page wrapper. */
export async function listAdminJobs(status?: string | null): Promise<AdminJob[]> {
  const res = await api<AdminJob[] | { content: AdminJob[] }>(
    `/admin/jobs${status ? `?status=${encodeURIComponent(status)}` : ""}`,
  );
  return Array.isArray(res) ? res : (res?.content ?? []);
}
