"use client";

import { Building2, Loader2, Plus } from "lucide-react";
import { useState } from "react";
import { EmptyState, ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { useCurrentWorkspace } from "@/hooks/use-current-workspace";
import type { Workspace } from "@/types/api";
import { CreateWorkspaceDialog } from "./create-workspace-dialog";

/** Renders `children(workspace)` once a workspace is selected; handles loading/error/none states. */
export function WorkspaceBoundary({ children }: { children: (workspace: Workspace) => React.ReactNode }) {
  const { workspace, isLoading, error, refetch } = useCurrentWorkspace();
  const [open, setOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center p-10" role="status">
        <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
        <span className="sr-only">Loading workspace…</span>
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-6">
        <ErrorState error={error} title="Couldn't load your workspaces" onRetry={() => refetch()} />
      </div>
    );
  }
  if (!workspace) {
    return (
      <div className="p-6">
        <EmptyState
          icon={Building2}
          title="Create your first workspace"
          description="A workspace holds documents, collections and conversations. You can invite teammates later."
          action={
            <Button onClick={() => setOpen(true)}>
              <Plus aria-hidden /> New workspace
            </Button>
          }
        />
        <CreateWorkspaceDialog open={open} onOpenChange={setOpen} />
      </div>
    );
  }
  return <>{children(workspace)}</>;
}

export function PageContainer({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={`mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 sm:p-6 ${className ?? ""}`}>{children}</div>;
}
