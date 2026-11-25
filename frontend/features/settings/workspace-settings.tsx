"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2, UserPlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Field } from "@/components/field";
import { ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { qk } from "@/lib/query-keys";
import { useSessionStore } from "@/lib/session-store";
import { validateEmail } from "@/lib/validation";
import {
  addMember,
  deleteWorkspace,
  listMembers,
  removeMember,
  updateMember,
  updateWorkspace,
} from "@/services/workspaces";
import type { Member, Role, Workspace } from "@/types/api";

const ROLES: { value: Role; label: string; hint: string }[] = [
  { value: "OWNER", label: "Owner", hint: "Full control incl. members" },
  { value: "MEMBER", label: "Member", hint: "Upload, organise, chat" },
  { value: "VIEWER", label: "Viewer", hint: "Read and chat" },
];

function GeneralCard({ workspace, isOwner }: { workspace: Workspace; isOwner: boolean }) {
  const qc = useQueryClient();
  const setCurrent = useSessionStore((s) => s.setCurrentWorkspaceId);
  const [name, setName] = useState(workspace.name);
  const [description, setDescription] = useState(workspace.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const save = useMutation({
    mutationFn: () =>
      updateWorkspace(workspace.id, { name: name.trim(), description: description.trim() || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.workspaces });
      toast.success("Workspace updated");
    },
    onError: (err) => setError(errorMessage(err)),
  });
  const del = useMutation({
    mutationFn: () => deleteWorkspace(workspace.id),
    onSuccess: () => {
      setCurrent(null);
      qc.invalidateQueries({ queryKey: qk.workspaces });
      toast.success(`Workspace “${workspace.name}” deleted`);
      setConfirmDelete(false);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Workspace</CardTitle>
        <CardDescription>
          {isOwner ? "Rename or describe this workspace." : "Only owners can change workspace settings."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid max-w-md gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return setError("Name is required.");
            setError(null);
            save.mutate();
          }}
        >
          <Field id="ws-settings-name" label="Name" error={error}>
            <Input
              id="ws-settings-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!isOwner}
              aria-invalid={!!error}
              aria-describedby={error ? "ws-settings-name-error" : undefined}
            />
          </Field>
          <Field id="ws-settings-desc" label="Description">
            <Textarea
              id="ws-settings-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={!isOwner}
              rows={3}
            />
          </Field>
          {isOwner && (
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={save.isPending}>
                {save.isPending && <Loader2 className="animate-spin" aria-hidden />}
                Save
              </Button>
              <Button type="button" variant="destructive" onClick={() => setConfirmDelete(true)}>
                <Trash2 aria-hidden /> Delete workspace
              </Button>
            </div>
          )}
        </form>
      </CardContent>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete workspace?"
        description={
          <>
            “{workspace.name}” and all of its documents, collections and conversations will be permanently deleted. This
            cannot be undone.
          </>
        }
        confirmLabel="Delete workspace"
        destructive
        pending={del.isPending}
        onConfirm={() => del.mutate()}
      />
    </Card>
  );
}

function MembersCard({ workspace, isOwner }: { workspace: Workspace; isOwner: boolean }) {
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.user);
  const members = useQuery({ queryKey: qk.members(workspace.id), queryFn: () => listMembers(workspace.id) });
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("MEMBER");
  const [addError, setAddError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Member | null>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: qk.members(workspace.id) });

  const add = useMutation({
    mutationFn: () => addMember(workspace.id, { email: email.trim(), role }),
    onSuccess: (m) => {
      invalidate();
      setEmail("");
      toast.success(`${m.displayName || m.email} added`);
    },
    onError: (err) => setAddError(errorMessage(err)),
  });
  const change = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Role }) => updateMember(workspace.id, userId, role),
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: qk.workspaces });
      toast.success("Role updated");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const remove = useMutation({
    mutationFn: (m: Member) => removeMember(workspace.id, m.userId),
    onSuccess: (_, m) => {
      invalidate();
      toast.success(`${m.displayName || m.email} removed`);
      setRemoving(null);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Members</CardTitle>
        <CardDescription>
          {isOwner ? "Invite existing users by email and manage their roles." : "People with access to this workspace."}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {isOwner && (
          <form
            className="grid gap-2 sm:grid-cols-[1fr_9rem_auto] sm:items-end"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              const err = validateEmail(email);
              setAddError(err ?? null);
              if (!err) add.mutate();
            }}
          >
            <Field id="member-email" label="Email" error={addError}>
              <Input
                id="member-email"
                type="email"
                placeholder="teammate@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={!!addError}
                aria-describedby={addError ? "member-email-error" : undefined}
              />
            </Field>
            <div className="grid gap-1.5 self-start">
              <Label htmlFor="member-role">Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                <SelectTrigger id="member-role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" disabled={add.isPending} className="self-start sm:mt-5.5">
              {add.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <UserPlus aria-hidden />}
              Add
            </Button>
          </form>
        )}

        {members.isLoading ? (
          <div className="grid gap-2">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : members.error ? (
          <ErrorState error={members.error} onRetry={() => members.refetch()} />
        ) : (
          <div className="overflow-hidden rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead className="w-36">Role</TableHead>
                  {isOwner && (
                    <TableHead className="w-12">
                      <span className="sr-only">Remove</span>
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.data!.map((m) => (
                  <TableRow key={m.userId}>
                    <TableCell className="max-w-[12rem]">
                      <p className="truncate font-medium">
                        {m.displayName}
                        {m.userId === me?.id && <span className="font-normal text-muted-foreground"> (you)</span>}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                    </TableCell>
                    <TableCell>
                      {isOwner ? (
                        <Select
                          value={m.role}
                          onValueChange={(v) => change.mutate({ userId: m.userId, role: v as Role })}
                          disabled={change.isPending}
                        >
                          <SelectTrigger size="sm" className="w-full" aria-label={`Role for ${m.displayName}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ROLES.map((r) => (
                              <SelectItem key={r.value} value={r.value}>
                                {r.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge variant="secondary">{ROLES.find((r) => r.value === m.role)?.label ?? m.role}</Badge>
                      )}
                    </TableCell>
                    {isOwner && (
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Remove ${m.displayName}`}
                          onClick={() => setRemoving(m)}
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Remove member?"
        description={
          removing?.userId === me?.id ? (
            <>You will lose access to “{workspace.name}”.</>
          ) : (
            <>
              {removing?.displayName} ({removing?.email}) will lose access to “{workspace.name}”.
            </>
          )
        }
        confirmLabel="Remove"
        destructive
        pending={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing)}
      />
    </Card>
  );
}

export function WorkspaceSettings({ workspace }: { workspace: Workspace }) {
  const isOwner = workspace.role === "OWNER";
  return (
    <div className="grid gap-4">
      <GeneralCard key={workspace.id + workspace.updatedAt} workspace={workspace} isOwner={isOwner} />
      <MembersCard workspace={workspace} isOwner={isOwner} />
    </div>
  );
}
