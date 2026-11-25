import { api, ApiError, authFetch, readProblem } from "@/lib/api-client";
import type { Chunk, Document, DocumentPatch, DocumentStatus, DocumentStatusInfo, Page } from "@/types/api";

export type DocumentFilters = { collectionId?: string | null; status?: DocumentStatus | null; q?: string | null };

export function listDocuments(workspaceId: string, filters: DocumentFilters = {}) {
  const params = new URLSearchParams();
  if (filters.collectionId) params.set("collectionId", filters.collectionId);
  if (filters.status) params.set("status", filters.status);
  if (filters.q) params.set("q", filters.q);
  const qs = params.toString();
  return api<Document[]>(`/workspaces/${workspaceId}/documents${qs ? `?${qs}` : ""}`);
}

export function uploadDocument(workspaceId: string, file: File, collectionId?: string | null, signal?: AbortSignal) {
  const form = new FormData();
  form.append("file", file, file.name);
  if (collectionId) form.append("collectionId", collectionId);
  return api<Document>(`/workspaces/${workspaceId}/documents`, { method: "POST", body: form, signal });
}

export const getDocument = (id: string) => api<Document>(`/documents/${id}`);
export const getDocumentStatus = (id: string) => api<DocumentStatusInfo>(`/documents/${id}/status`);
export const patchDocument = (id: string, body: DocumentPatch) =>
  api<Document>(`/documents/${id}`, { method: "PATCH", body });
export const reprocessDocument = (id: string) => api<Document>(`/documents/${id}/reprocess`, { method: "POST" });
export const deleteDocument = (id: string) => api<void>(`/documents/${id}`, { method: "DELETE" });
export const listChunks = (id: string, page = 0, size = 20) =>
  api<Page<Chunk>>(`/documents/${id}/chunks?page=${page}&size=${size}`);

function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const star = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ""));
    } catch {
      /* fall through */
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(header);
  return plain ? plain[1].trim() : null;
}

/** Downloads the original file with the Bearer token (an <a href> cannot send the header). */
export async function downloadDocument(doc: Pick<Document, "id" | "originalFilename">) {
  const res = await authFetch(`/documents/${doc.id}/download`);
  if (!res.ok) throw new ApiError(res.status, await readProblem(res));
  const blob = await res.blob();
  const name = filenameFromDisposition(res.headers.get("content-disposition")) ?? doc.originalFilename;
  const url = URL.createObjectURL(blob);
  const a = window.document.createElement("a");
  a.href = url;
  a.download = name;
  window.document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const isInFlight = (status: DocumentStatus) =>
  status === "QUEUED" || status === "PROCESSING" || status === "UPLOADED";
