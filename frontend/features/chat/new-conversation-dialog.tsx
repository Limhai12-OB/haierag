"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Field } from "@/components/field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api-client";
import { qk } from "@/lib/query-keys";
import { listCollections } from "@/services/collections";
import { createConversation } from "@/services/conversations";
import { listDocuments } from "@/services/documents";
import type { CreateConversationRequest, ScopeType } from "@/types/api";

type Props = { workspaceId: string; open: boolean; onOpenChange: (o: boolean) => void };

export function NewConversationDialog({ workspaceId, open, onOpenChange }: Props) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <NewConversationForm workspaceId={workspaceId} onOpenChange={onOpenChange} onBusyChange={setBusy} />
      </DialogContent>
    </Dialog>
  );
}

function NewConversationForm({
  workspaceId,
  onOpenChange,
  onBusyChange,
}: Omit<Props, "open"> & { onBusyChange: (b: boolean) => void }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [scope, setScope] = useState<ScopeType>("WORKSPACE");
  const [collectionId, setCollectionId] = useState<string>("");
  const [docIds, setDocIds] = useState<string[]>([]);
  const [docFilter, setDocFilter] = useState("");
  const [error, setError] = useState<string | null>(null);

  const collections = useQuery({
    queryKey: qk.collections(workspaceId),
    queryFn: () => listCollections(workspaceId),
    enabled: scope === "COLLECTION",
  });
  const documents = useQuery({
    queryKey: qk.documents(workspaceId, { status: "COMPLETED" }),
    queryFn: () => listDocuments(workspaceId, { status: "COMPLETED" }),
    enabled: scope === "DOCUMENTS",
  });
  const visibleDocs = useMemo(() => {
    const f = docFilter.trim().toLowerCase();
    return (documents.data ?? []).filter((d) => !f || d.name.toLowerCase().includes(f));
  }, [documents.data, docFilter]);

  const create = useMutation({
    mutationFn: createConversation,
    onMutate: () => onBusyChange(true),
    onSettled: () => onBusyChange(false),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: qk.conversations(workspaceId) });
      onOpenChange(false);
      router.push(`/chat/${c.id}`);
    },
    onError: (err) => setError(errorMessage(err)),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const body: CreateConversationRequest = { workspaceId, scopeType: scope };
    if (title.trim()) body.title = title.trim();
    if (scope === "COLLECTION") {
      if (!collectionId) return setError("Choose a collection.");
      body.collectionId = collectionId;
    }
    if (scope === "DOCUMENTS") {
      if (docIds.length === 0) return setError("Select at least one document.");
      body.documentIds = docIds;
    }
    setError(null);
    create.mutate(body);
  }

  const toggleDoc = (id: string, on: boolean) =>
    setDocIds((ids) => (on ? [...new Set([...ids, id])] : ids.filter((x) => x !== id)));

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>New conversation</DialogTitle>
        <DialogDescription>Choose which documents the assistant may search for this chat.</DialogDescription>
      </DialogHeader>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Field id="conv-title" label="Title (optional)">
        <Input id="conv-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
      </Field>
      <fieldset className="grid gap-2">
        <legend className="mb-1.5 text-sm font-medium">Scope</legend>
        <RadioGroup value={scope} onValueChange={(v) => setScope(v as ScopeType)} className="grid gap-2">
          {(
            [
              ["WORKSPACE", "Whole workspace", "Search every processed document."],
              ["COLLECTION", "A collection", "Only documents in one collection."],
              ["DOCUMENTS", "Selected documents", "Pick specific documents."],
            ] as const
          ).map(([value, label, hint]) => (
            <Label
              key={value}
              htmlFor={`scope-${value}`}
              className="flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 font-normal has-data-[state=checked]:border-primary/50 has-data-[state=checked]:bg-muted/50"
            >
              <RadioGroupItem id={`scope-${value}`} value={value} className="mt-0.5" />
              <span className="grid gap-0.5">
                <span className="font-medium">{label}</span>
                <span className="text-xs text-muted-foreground">{hint}</span>
              </span>
            </Label>
          ))}
        </RadioGroup>
      </fieldset>

      {scope === "COLLECTION" && (
        <div className="grid gap-1.5">
          <Label htmlFor="conv-collection">Collection</Label>
          {collections.isLoading ? (
            <Skeleton className="h-8" />
          ) : (collections.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">This workspace has no collections yet.</p>
          ) : (
            <Select value={collectionId} onValueChange={setCollectionId}>
              <SelectTrigger id="conv-collection" className="w-full">
                <SelectValue placeholder="Choose a collection" />
              </SelectTrigger>
              <SelectContent>
                {collections.data!.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} ({c.documentCount})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      )}

      {scope === "DOCUMENTS" && (
        <div className="grid gap-2">
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              aria-label="Filter documents"
              placeholder="Filter documents…"
              value={docFilter}
              onChange={(e) => setDocFilter(e.target.value)}
              className="pl-8"
            />
          </div>
          <div className="max-h-56 overflow-y-auto rounded-lg border">
            {documents.isLoading ? (
              <div className="grid gap-1 p-2">
                <Skeleton className="h-7" />
                <Skeleton className="h-7" />
              </div>
            ) : visibleDocs.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">No processed documents found.</p>
            ) : (
              <ul className="divide-y">
                {visibleDocs.map((d) => (
                  <li key={d.id}>
                    <Label
                      htmlFor={`doc-${d.id}`}
                      className="flex cursor-pointer items-center gap-2 px-2.5 py-2 font-normal hover:bg-muted/50"
                    >
                      <Checkbox
                        id={`doc-${d.id}`}
                        checked={docIds.includes(d.id)}
                        onCheckedChange={(v) => toggleDoc(d.id, v === true)}
                      />
                      <span className="truncate">{d.name}</span>
                    </Label>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{docIds.length} selected</p>
        </div>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={create.isPending}>
          Cancel
        </Button>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending && <Loader2 className="animate-spin" aria-hidden />}
          Start chat
        </Button>
      </DialogFooter>
    </form>
  );
}
