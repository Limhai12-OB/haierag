"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Field } from "@/components/field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/api-client";
import { qk } from "@/lib/query-keys";
import { createCollection, updateCollection } from "@/services/collections";
import type { Collection } from "@/types/api";

type Props = {
  workspaceId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** When set, the dialog renames/edits this collection. */
  collection?: Collection | null;
  onCreated?: (c: Collection) => void;
};

export function CollectionDialog(props: Props) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={props.open} onOpenChange={(o) => !busy && props.onOpenChange(o)}>
      <DialogContent>
        {/* Mounted per opening, so the form state starts from the current props. */}
        <CollectionForm {...props} onBusyChange={setBusy} />
      </DialogContent>
    </Dialog>
  );
}

function CollectionForm({
  workspaceId,
  onOpenChange,
  collection,
  onCreated,
  onBusyChange,
}: Props & { onBusyChange: (b: boolean) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(collection?.name ?? "");
  const [description, setDescription] = useState(collection?.description ?? "");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (body: { name: string; description?: string }) =>
      collection ? updateCollection(collection.id, body) : createCollection(workspaceId, body),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: qk.collections(workspaceId) });
      qc.invalidateQueries({ queryKey: qk.documents(workspaceId) });
      qc.invalidateQueries({ queryKey: qk.stats(workspaceId) });
      toast.success(collection ? "Collection updated" : `Collection “${c.name}” created`);
      if (!collection) onCreated?.(c);
      onOpenChange(false);
    },
    onError: (err) => setError(errorMessage(err)),
    onMutate: () => onBusyChange(true),
    onSettled: () => onBusyChange(false),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Name is required.");
    mutation.mutate({ name: name.trim(), description: description.trim() || undefined });
  }

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{collection ? "Edit collection" : "New collection"}</DialogTitle>
        <DialogDescription>Collections group documents so chats can be scoped to them.</DialogDescription>
      </DialogHeader>
      <Field id="col-name" label="Name" error={error}>
        <Input
          id="col-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          aria-invalid={!!error}
          aria-describedby={error ? "col-name-error" : undefined}
          autoFocus
        />
      </Field>
      <Field id="col-desc" label="Description (optional)">
        <Textarea id="col-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
          Cancel
        </Button>
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending && <Loader2 className="animate-spin" aria-hidden />}
          {collection ? "Save" : "Create"}
        </Button>
      </DialogFooter>
    </form>
  );
}
