"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { errorMessage } from "@/lib/api-client";
import { qk } from "@/lib/query-keys";
import { deleteDocument, downloadDocument, patchDocument, reprocessDocument } from "@/services/documents";
import type { Document } from "@/types/api";

export function useDocumentActions(workspaceId: string) {
  const qc = useQueryClient();
  const invalidate = (docId?: string) => {
    qc.invalidateQueries({ queryKey: qk.documents(workspaceId) });
    qc.invalidateQueries({ queryKey: qk.collections(workspaceId) });
    qc.invalidateQueries({ queryKey: qk.stats(workspaceId) });
    qc.invalidateQueries({ queryKey: qk.activity(workspaceId) });
    if (docId) {
      qc.invalidateQueries({ queryKey: qk.document(docId) });
    }
  };

  const reprocess = useMutation({
    mutationFn: (d: Document) => reprocessDocument(d.id),
    onSuccess: (d) => {
      qc.setQueryData(qk.document(d.id), d);
      invalidate(d.id);
      toast.success(`Reprocessing “${d.name}”`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const remove = useMutation({
    mutationFn: (d: Document) => deleteDocument(d.id),
    onSuccess: (_, d) => {
      qc.removeQueries({ queryKey: qk.document(d.id) });
      invalidate();
      toast.success(`Deleted “${d.name}”`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const move = useMutation({
    mutationFn: ({ doc, collectionId }: { doc: Document; collectionId: string | null }) =>
      patchDocument(doc.id, { collectionId }),
    onSuccess: (d) => {
      qc.setQueryData(qk.document(d.id), d);
      invalidate(d.id);
      toast.success(d.collectionName ? `Moved to “${d.collectionName}”` : "Removed from collection");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const download = useMutation({
    mutationFn: (d: Document) => downloadDocument(d),
    onError: (err) => toast.error(errorMessage(err, "Download failed")),
  });

  return { reprocess, remove, move, download };
}
