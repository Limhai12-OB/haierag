"use client";

import { Download, ExternalLink, FolderInput, MoreHorizontal, RefreshCw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MoveCollectionDialog } from "@/features/documents/move-collection-dialog";
import { useDocumentActions } from "@/features/documents/use-document-actions";
import { formatBytes, formatRelative } from "@/lib/format";
import type { Collection, Document } from "@/types/api";

export function DocumentsTable({
  workspaceId,
  documents,
  collections,
  canEdit,
}: {
  workspaceId: string;
  documents: Document[];
  collections: Collection[];
  canEdit: boolean;
}) {
  const actions = useDocumentActions(workspaceId);
  const [deleting, setDeleting] = useState<Document | null>(null);
  const [moving, setMoving] = useState<Document | null>(null);

  return (
    <>
      <div className="overflow-hidden rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="hidden md:table-cell">Collection</TableHead>
              <TableHead className="hidden sm:table-cell">Size</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden lg:table-cell">Uploaded</TableHead>
              <TableHead className="w-10">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {documents.map((d) => (
              <TableRow key={d.id}>
                <TableCell className="max-w-[14rem] sm:max-w-xs">
                  <Link href={`/documents/${d.id}`} className="block truncate font-medium hover:underline">
                    {d.name}
                  </Link>
                  <span className="text-xs text-muted-foreground">
                    {d.fileType}
                    {d.status === "COMPLETED" && ` · ${d.chunkCount} chunks`}
                  </span>
                </TableCell>
                <TableCell className="hidden max-w-[10rem] truncate text-muted-foreground md:table-cell">
                  {d.collectionName ?? "—"}
                </TableCell>
                <TableCell className="hidden text-muted-foreground tabular-nums sm:table-cell">
                  {formatBytes(d.sizeBytes)}
                </TableCell>
                <TableCell>
                  <StatusBadge status={d.status} />
                  {d.status === "FAILED" && d.errorMessage && (
                    <p className="mt-0.5 max-w-[12rem] truncate text-xs text-destructive" title={d.errorMessage}>
                      {d.errorMessage}
                    </p>
                  )}
                </TableCell>
                <TableCell className="hidden text-muted-foreground lg:table-cell">
                  <time dateTime={d.createdAt}>{formatRelative(d.createdAt)}</time>
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${d.name}`}>
                        <MoreHorizontal aria-hidden />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild>
                        <Link href={`/documents/${d.id}`}>
                          <ExternalLink aria-hidden /> Open
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => actions.download.mutate(d)}>
                        <Download aria-hidden /> Download
                      </DropdownMenuItem>
                      {canEdit && (
                        <>
                          <DropdownMenuItem onSelect={() => setMoving(d)}>
                            <FolderInput aria-hidden /> Move to collection
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => actions.reprocess.mutate(d)}
                            disabled={d.status === "QUEUED" || d.status === "PROCESSING"}
                          >
                            <RefreshCw aria-hidden /> Reprocess
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(d)}>
                            <Trash2 aria-hidden /> Delete
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete document?"
        description={<>“{deleting?.name}”, its chunks and stored files will be permanently deleted.</>}
        confirmLabel="Delete"
        destructive
        pending={actions.remove.isPending}
        onConfirm={() => deleting && actions.remove.mutate(deleting, { onSettled: () => setDeleting(null) })}
      />
      <MoveCollectionDialog
        doc={moving}
        collections={collections}
        open={!!moving}
        onOpenChange={(o) => !o && setMoving(null)}
        pending={actions.move.isPending}
        onMove={(collectionId) =>
          moving && actions.move.mutate({ doc: moving, collectionId }, { onSuccess: () => setMoving(null) })
        }
      />
    </>
  );
}
