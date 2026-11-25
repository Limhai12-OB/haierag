"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FolderOpen, Library, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api-client";
import { qk } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { deleteCollection } from "@/services/collections";
import type { Collection } from "@/types/api";
import { CollectionDialog } from "./collection-dialog";

type Props = {
  workspaceId: string;
  collections: Collection[] | undefined;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  canEdit: boolean;
};

export function CollectionsPanel({
  workspaceId,
  collections,
  isLoading,
  error,
  onRetry,
  selectedId,
  onSelect,
  canEdit,
}: Props) {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Collection | null>(null);
  const [deleting, setDeleting] = useState<Collection | null>(null);

  const del = useMutation({
    mutationFn: (c: Collection) => deleteCollection(c.id),
    onSuccess: (_, c) => {
      qc.invalidateQueries({ queryKey: qk.collections(workspaceId) });
      qc.invalidateQueries({ queryKey: qk.documents(workspaceId) });
      qc.invalidateQueries({ queryKey: qk.stats(workspaceId) });
      if (selectedId === c.id) onSelect(null);
      toast.success(`Collection “${c.name}” deleted`);
      setDeleting(null);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const item = (id: string | null, label: string, count: number | null, Icon: typeof FolderOpen) => (
    <button
      type="button"
      onClick={() => onSelect(id)}
      aria-pressed={selectedId === id}
      className={cn(
        "flex w-full min-w-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50",
        selectedId === id && "bg-muted font-medium",
      )}
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="flex-1 truncate">{label}</span>
      {count !== null && <span className="text-xs text-muted-foreground tabular-nums">{count}</span>}
    </button>
  );

  return (
    <section aria-labelledby="collections-heading" className="flex flex-col gap-2">
      <div className="flex items-center justify-between px-1">
        <h2 id="collections-heading" className="text-sm font-medium">
          Collections
        </h2>
        {canEdit && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="New collection"
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus aria-hidden />
          </Button>
        )}
      </div>
      {item(null, "All documents", null, Library)}
      {isLoading ? (
        <div className="grid gap-1.5">
          <Skeleton className="h-8" />
          <Skeleton className="h-8" />
        </div>
      ) : error ? (
        <ErrorState error={error} onRetry={onRetry} className="py-4" />
      ) : (collections ?? []).length === 0 ? (
        <p className="px-2.5 py-2 text-xs text-muted-foreground">
          No collections yet.{canEdit && " Use + to group documents."}
        </p>
      ) : (
        <ul className="grid gap-0.5">
          {collections!.map((c) => (
            <li key={c.id} className="group flex items-center gap-0.5">
              {item(c.id, c.name, c.documentCount, FolderOpen)}
              {canEdit && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${c.name}`}>
                      <MoreHorizontal aria-hidden />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onSelect={() => {
                        setEditing(c);
                        setDialogOpen(true);
                      }}
                    >
                      <Pencil aria-hidden /> Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(c)}>
                      <Trash2 aria-hidden /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </li>
          ))}
        </ul>
      )}
      <CollectionDialog
        workspaceId={workspaceId}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        collection={editing}
        onCreated={(c) => onSelect(c.id)}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete collection?"
        description={
          <>
            “{deleting?.name}” will be deleted. Its {deleting?.documentCount ?? 0} document(s) are kept but will no
            longer belong to any collection.
          </>
        }
        confirmLabel="Delete collection"
        destructive
        pending={del.isPending}
        onConfirm={() => deleting && del.mutate(deleting)}
      />
    </section>
  );
}
