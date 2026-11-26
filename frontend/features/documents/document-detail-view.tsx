"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Download, ExternalLink, FileQuestion, FolderInput, Loader2, RefreshCw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState, ErrorState, PageHeader } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { hasRole, useWorkspaces } from "@/hooks/use-current-workspace";
import { PageContainer } from "@/features/shell/workspace-boundary";
import { ApiError } from "@/lib/api-client";
import { fileTypeLabel, formatBytes, formatDateTime, humanize, safeExternalUrl } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import { listCollections } from "@/services/collections";
import { getDocument, getDocumentStatus, isInFlight } from "@/services/documents";
import { ChunkInspector } from "./chunk-inspector";
import { MoveCollectionDialog } from "./move-collection-dialog";
import { useDocumentActions } from "./use-document-actions";

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm">{children}</dd>
    </div>
  );
}

export function DocumentDetailView({ id }: { id: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const doc = useQuery({
    queryKey: qk.document(id),
    queryFn: () => getDocument(id),
    refetchInterval: (q) => (q.state.data && isInFlight(q.state.data.status) ? 3000 : false),
  });
  const inFlight = !!doc.data && isInFlight(doc.data.status);
  const status = useQuery({
    queryKey: qk.documentStatus(id),
    queryFn: () => getDocumentStatus(id),
    enabled: !!doc.data,
    refetchInterval: inFlight ? 3000 : false,
  });
  const workspaces = useWorkspaces();
  const workspaceId = doc.data?.workspaceId ?? "";
  const workspace = workspaces.data?.find((w) => w.id === workspaceId) ?? null;
  const canEdit = hasRole(workspace, "MEMBER");
  const collections = useQuery({
    queryKey: qk.collections(workspaceId),
    queryFn: () => listCollections(workspaceId),
    enabled: !!workspaceId && canEdit,
  });
  const actions = useDocumentActions(workspaceId);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);

  // When processing finishes, refresh chunks and the status card.
  const prevStatus = useRef(doc.data?.status);
  useEffect(() => {
    const s = doc.data?.status;
    if (prevStatus.current && s && prevStatus.current !== s) {
      qc.invalidateQueries({ queryKey: ["documents", id, "chunks"] });
      qc.invalidateQueries({ queryKey: qk.documentStatus(id) });
      if (workspaceId) qc.invalidateQueries({ queryKey: qk.documents(workspaceId) });
    }
    prevStatus.current = s;
  }, [doc.data?.status, id, qc, workspaceId]);

  if (doc.isLoading) {
    return (
      <PageContainer>
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40" />
        <Skeleton className="h-64" />
      </PageContainer>
    );
  }
  if (doc.error) {
    const notFound = doc.error instanceof ApiError && (doc.error.status === 404 || doc.error.status === 403);
    return (
      <PageContainer>
        {notFound ? (
          <EmptyState
            icon={FileQuestion}
            title="Document not found"
            description="It may have been deleted, or it belongs to a workspace you can't access."
            action={
              <Button variant="outline" asChild>
                <Link href="/knowledge-base">Back to Knowledge Base</Link>
              </Button>
            }
          />
        ) : (
          <ErrorState error={doc.error} title="Couldn't load document" onRetry={() => doc.refetch()} />
        )}
      </PageContainer>
    );
  }

  const d = doc.data!;
  const job = status.data?.job ?? null;
  const errorText = status.data?.errorMessage ?? d.errorMessage;

  return (
    <PageContainer>
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2">
          <Link href="/knowledge-base">
            <ArrowLeft aria-hidden /> Knowledge Base
          </Link>
        </Button>
      </div>
      <PageHeader
        title={d.name}
        description={d.originalFilename !== d.name ? d.originalFilename : undefined}
        actions={
          <>
            <Button variant="outline" onClick={() => actions.download.mutate(d)} disabled={actions.download.isPending}>
              {actions.download.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}
              Download
            </Button>
            {canEdit && (
              <>
                <Button variant="outline" onClick={() => setMoveOpen(true)}>
                  <FolderInput aria-hidden /> Move
                </Button>
                <Button
                  variant="outline"
                  onClick={() => actions.reprocess.mutate(d)}
                  disabled={actions.reprocess.isPending || d.status === "QUEUED" || d.status === "PROCESSING"}
                >
                  <RefreshCw className={actions.reprocess.isPending ? "animate-spin" : undefined} aria-hidden />
                  Reprocess
                </Button>
                <Button variant="destructive" onClick={() => setConfirmDelete(true)}>
                  <Trash2 aria-hidden /> Delete
                </Button>
              </>
            )}
          </>
        }
      />

      {d.status === "FAILED" && errorText && (
        <Alert variant="destructive">
          <AlertTitle>Processing failed</AlertTitle>
          <AlertDescription>{errorText}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Meta label="Type">{fileTypeLabel(d.fileType)}</Meta>
              <Meta label="Size">{formatBytes(d.sizeBytes)}</Meta>
              <Meta label="Collection">{d.collectionName ?? "—"}</Meta>
              <Meta label="Pages">{d.pageCount ?? "—"}</Meta>
              <Meta label="Chunks">{d.chunkCount}</Meta>
              <Meta label="Content type">{d.contentType}</Meta>
              <Meta label="Uploaded">{formatDateTime(d.createdAt)}</Meta>
              <Meta label="Processed">{formatDateTime(d.processedAt)}</Meta>
              <Meta label="Updated">{formatDateTime(d.updatedAt)}</Meta>
            </dl>
            {safeExternalUrl(d.sourceUrl) && (
              <div className="mt-4 space-y-1 border-t pt-4 text-sm">
                <p className="text-xs text-muted-foreground">Imported from</p>
                <a
                  href={safeExternalUrl(d.sourceUrl)!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex max-w-full items-center gap-1 break-all font-medium hover:underline"
                >
                  {d.sourceUrl}
                  <ExternalLink className="size-3.5 shrink-0" aria-hidden />
                </a>
                <p className="text-xs text-muted-foreground">
                  The page was saved when it was imported. Reprocess re-reads that saved copy; import the link again to
                  pick up changes to the page.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-2">
              Processing <StatusBadge status={d.status} />
            </CardTitle>
          </CardHeader>
          <CardContent>
            {status.isLoading ? (
              <Skeleton className="h-24" />
            ) : !job ? (
              <p className="text-sm text-muted-foreground">No processing job recorded.</p>
            ) : (
              <dl className="grid grid-cols-2 gap-3">
                <Meta label="Job status">{humanize(job.status)}</Meta>
                <Meta label="Stage">{job.stage ? humanize(job.stage) : "—"}</Meta>
                <Meta label="Attempts">{job.attempts}</Meta>
                <Meta label="Started">{formatDateTime(job.startedAt)}</Meta>
                <Meta label="Finished">{formatDateTime(job.finishedAt)}</Meta>
                {Object.entries(job.metrics ?? {})
                  .filter(([, v]) => typeof v === "number" || typeof v === "string")
                  .slice(0, 6)
                  .map(([k, v]) => (
                    <Meta key={k} label={humanize(k)}>
                      {String(v)}
                    </Meta>
                  ))}
              </dl>
            )}
            {inFlight && (
              <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
                <Loader2 className="size-3 animate-spin" aria-hidden /> Updating automatically…
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <section aria-labelledby="chunks-heading" className="grid gap-3">
        <h2 id="chunks-heading" className="text-base font-semibold">
          Chunks
        </h2>
        <ChunkInspector documentId={d.id} enabled={d.status === "COMPLETED" || d.chunkCount > 0} />
      </section>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete document?"
        description={<>“{d.name}”, its chunks and stored files will be permanently deleted.</>}
        confirmLabel="Delete"
        destructive
        pending={actions.remove.isPending}
        onConfirm={() =>
          actions.remove.mutate(d, {
            onSuccess: () => router.replace("/knowledge-base"),
            onSettled: () => setConfirmDelete(false),
          })
        }
      />
      <MoveCollectionDialog
        doc={d}
        collections={collections.data ?? []}
        open={moveOpen}
        onOpenChange={setMoveOpen}
        pending={actions.move.isPending}
        onMove={(collectionId) =>
          actions.move.mutate({ doc: d, collectionId }, { onSuccess: () => setMoveOpen(false) })
        }
      />
    </PageContainer>
  );
}
