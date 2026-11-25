"use client";

import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentWorkspace } from "@/hooks/use-current-workspace";
import { useSessionStore } from "@/lib/session-store";
import { CreateWorkspaceDialog } from "./create-workspace-dialog";

export function WorkspaceSwitcher() {
  const { workspace, workspaces, isLoading } = useCurrentWorkspace();
  const setCurrent = useSessionStore((s) => s.setCurrentWorkspaceId);
  const [createOpen, setCreateOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  function select(id: string) {
    setCurrent(id);
    // Detail pages belong to the previous workspace — go to the matching list.
    if (pathname.startsWith("/documents/")) router.push("/knowledge-base");
    else if (pathname.startsWith("/chat/")) router.push("/chat");
  }

  if (isLoading) return <Skeleton className="h-10 w-full" />;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="h-10 w-full justify-between px-2.5" aria-label="Switch workspace">
            <span className="flex min-w-0 flex-col items-start text-left">
              <span className="text-[0.65rem] tracking-wide text-muted-foreground uppercase">Workspace</span>
              <span className="w-full truncate text-sm">{workspace?.name ?? "No workspace"}</span>
            </span>
            <ChevronsUpDown className="text-muted-foreground" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-(--radix-dropdown-menu-trigger-width) min-w-56">
          <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
          {workspaces.map((w) => (
            <DropdownMenuItem key={w.id} onSelect={() => select(w.id)}>
              <span className="flex-1 truncate">{w.name}</span>
              <span className="text-xs text-muted-foreground">{w.role.toLowerCase()}</span>
              {w.id === workspace?.id && <Check aria-label="Current" />}
            </DropdownMenuItem>
          ))}
          {workspaces.length === 0 && (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">You aren&apos;t in any workspace yet.</p>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setCreateOpen(true)}>
            <Plus aria-hidden /> New workspace
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateWorkspaceDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}
