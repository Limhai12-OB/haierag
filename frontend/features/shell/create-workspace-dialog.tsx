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
import { useSessionStore } from "@/lib/session-store";
import { createWorkspace } from "@/services/workspaces";

export function CreateWorkspaceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const setCurrent = useSessionStore((s) => s.setCurrentWorkspaceId);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: createWorkspace,
    onSuccess: (ws) => {
      qc.invalidateQueries({ queryKey: qk.workspaces });
      setCurrent(ws.id);
      toast.success(`Workspace “${ws.name}” created`);
      setName("");
      setDescription("");
      onOpenChange(false);
    },
    onError: (err) => setError(errorMessage(err)),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setError(null);
    mutation.mutate({ name: name.trim(), description: description.trim() || undefined });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !mutation.isPending && onOpenChange(o)}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>Create workspace</DialogTitle>
            <DialogDescription>Workspaces hold their own documents, collections, members and chats.</DialogDescription>
          </DialogHeader>
          <Field id="ws-name" label="Name" error={error}>
            <Input
              id="ws-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              aria-invalid={!!error}
              aria-describedby={error ? "ws-name-error" : undefined}
              autoFocus
            />
          </Field>
          <Field id="ws-desc" label="Description (optional)">
            <Textarea id="ws-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="animate-spin" aria-hidden />}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
