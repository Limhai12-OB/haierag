"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, MessageSquare, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api-client";
import { formatRelative } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { deleteConversation, listConversations, renameConversation } from "@/services/conversations";
import type { Conversation } from "@/types/api";

function RenameDialog({
  conversation,
  onClose,
  workspaceId,
}: {
  conversation: Conversation | null;
  onClose: () => void;
  workspaceId: string;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={!!conversation} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        {conversation && (
          <RenameForm conversation={conversation} onClose={onClose} workspaceId={workspaceId} onBusyChange={setBusy} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function RenameForm({
  conversation,
  onClose,
  workspaceId,
  onBusyChange,
}: {
  conversation: Conversation;
  onClose: () => void;
  workspaceId: string;
  onBusyChange: (b: boolean) => void;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(conversation.title);
  const rename = useMutation({
    mutationFn: () => renameConversation(conversation.id, title.trim()),
    onMutate: () => onBusyChange(true),
    onSettled: () => onBusyChange(false),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: qk.conversations(workspaceId) });
      qc.setQueryData(qk.conversation(c.id), (old: object | undefined) => (old ? { ...old, title: c.title } : old));
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim()) rename.mutate();
      }}
    >
      <DialogHeader>
        <DialogTitle>Rename conversation</DialogTitle>
      </DialogHeader>
      <div className="grid gap-1.5">
        <Label htmlFor="rename-conv">Title</Label>
        <Input id="rename-conv" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} autoFocus />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={rename.isPending}>
          Cancel
        </Button>
        <Button type="submit" disabled={!title.trim() || rename.isPending}>
          {rename.isPending && <Loader2 className="animate-spin" aria-hidden />}
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}

export function ConversationSidebar({
  workspaceId,
  activeId,
  onNew,
  onNavigate,
}: {
  workspaceId: string;
  activeId: string | null;
  onNew: () => void;
  onNavigate?: () => void;
}) {
  const qc = useQueryClient();
  const router = useRouter();
  const conversations = useQuery({
    queryKey: qk.conversations(workspaceId),
    queryFn: () => listConversations(workspaceId),
  });
  const [renaming, setRenaming] = useState<Conversation | null>(null);
  const [deleting, setDeleting] = useState<Conversation | null>(null);

  const del = useMutation({
    mutationFn: (c: Conversation) => deleteConversation(c.id),
    onSuccess: (_, c) => {
      qc.invalidateQueries({ queryKey: qk.conversations(workspaceId) });
      qc.removeQueries({ queryKey: qk.conversation(c.id) });
      if (activeId === c.id) router.replace("/chat");
      setDeleting(null);
      toast.success("Conversation deleted");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <div className="flex h-full flex-col">
      <div className="p-3">
        <Button className="w-full" onClick={onNew}>
          <Plus aria-hidden /> New conversation
        </Button>
      </div>
      <nav aria-label="Conversations" className="flex-1 overflow-y-auto px-2 pb-3">
        {conversations.isLoading ? (
          <div className="grid gap-1.5 px-1">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : conversations.error ? (
          <ErrorState error={conversations.error} onRetry={() => conversations.refetch()} className="mx-1 py-4" />
        ) : (conversations.data ?? []).length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-3 py-8 text-center text-sm text-muted-foreground">
            <MessageSquare className="size-5" aria-hidden />
            No conversations yet.
          </div>
        ) : (
          <ul className="grid gap-0.5">
            {conversations.data!.map((c) => (
              <li key={c.id} className="group relative">
                <Link
                  href={`/chat/${c.id}`}
                  onClick={onNavigate}
                  aria-current={activeId === c.id ? "page" : undefined}
                  className={cn(
                    "flex flex-col rounded-lg py-2 pr-9 pl-2.5 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50",
                    activeId === c.id && "bg-muted",
                  )}
                >
                  <span className="truncate">{c.title || "Untitled"}</span>
                  <span className="text-xs text-muted-foreground">{formatRelative(c.updatedAt)}</span>
                </Link>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Actions for ${c.title || "conversation"}`}
                      className="absolute top-1/2 right-1.5 -translate-y-1/2 opacity-100 focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100 data-[state=open]:opacity-100"
                    >
                      <MoreHorizontal aria-hidden />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setRenaming(c)}>
                      <Pencil aria-hidden /> Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(c)}>
                      <Trash2 aria-hidden /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            ))}
          </ul>
        )}
      </nav>
      <RenameDialog conversation={renaming} onClose={() => setRenaming(null)} workspaceId={workspaceId} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete conversation?"
        description={<>“{deleting?.title || "Untitled"}” and all its messages will be permanently deleted.</>}
        confirmLabel="Delete"
        destructive
        pending={del.isPending}
        onConfirm={() => deleting && del.mutate(deleting)}
      />
    </div>
  );
}
