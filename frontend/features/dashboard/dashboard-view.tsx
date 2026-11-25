"use client";

import { useQuery } from "@tanstack/react-query";
import { Activity as ActivityIcon, FileText, FolderOpen, Layers, MessageSquare, Plus, Upload } from "lucide-react";
import Link from "next/link";
import { EmptyState, ErrorState, PageHeader } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageContainer } from "@/features/shell/workspace-boundary";
import { formatRelative, humanize } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import { listConversations } from "@/services/conversations";
import { getWorkspaceActivity, getWorkspaceStats } from "@/services/workspaces";
import { DOCUMENT_STATUSES, type Activity, type DocumentStatus, type Workspace } from "@/types/api";

const STATUS_BAR: Record<DocumentStatus, string> = {
  UPLOADED: "bg-muted-foreground/40",
  QUEUED: "bg-amber-500",
  PROCESSING: "bg-sky-500",
  COMPLETED: "bg-emerald-500",
  FAILED: "bg-destructive",
};

function StatCard({
  label,
  value,
  icon: Icon,
  loading,
}: {
  label: string;
  value?: number;
  icon: typeof FileText;
  loading: boolean;
}) {
  return (
    <Card size="sm">
      <CardContent className="flex items-center gap-3">
        <div className="flex size-9 items-center justify-center rounded-lg bg-muted">
          <Icon className="size-4 text-muted-foreground" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          {loading ? (
            <Skeleton className="mt-1 h-6 w-12" />
          ) : (
            <p className="text-xl font-semibold tabular-nums">{(value ?? 0).toLocaleString()}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function activityText(a: Activity) {
  const name =
    typeof a.details?.name === "string"
      ? a.details.name
      : typeof a.details?.title === "string"
        ? a.details.title
        : null;
  return (
    <>
      <span className="font-medium">{a.actorName ?? "System"}</span>{" "}
      <span className="text-muted-foreground">{humanize(a.action).toLowerCase()}</span>
      {name && <span className="font-medium"> “{name}”</span>}
    </>
  );
}

export function DashboardView({ workspace }: { workspace: Workspace }) {
  const stats = useQuery({ queryKey: qk.stats(workspace.id), queryFn: () => getWorkspaceStats(workspace.id) });
  const activity = useQuery({ queryKey: qk.activity(workspace.id), queryFn: () => getWorkspaceActivity(workspace.id) });
  const conversations = useQuery({
    queryKey: qk.conversations(workspace.id),
    queryFn: () => listConversations(workspace.id),
  });

  const byStatus = stats.data?.documentsByStatus;
  const total = byStatus ? DOCUMENT_STATUSES.reduce((s, k) => s + (byStatus[k] ?? 0), 0) : 0;
  const canUpload = workspace.role !== "VIEWER";

  return (
    <PageContainer>
      <PageHeader
        title={workspace.name}
        description={workspace.description ?? "Overview of this workspace."}
        actions={
          <>
            {canUpload && (
              <Button variant="outline" asChild>
                <Link href="/knowledge-base">
                  <Upload aria-hidden /> Upload
                </Link>
              </Button>
            )}
            <Button asChild>
              <Link href="/chat">
                <MessageSquare aria-hidden /> Ask a question
              </Link>
            </Button>
          </>
        }
      />

      {stats.error ? (
        <ErrorState error={stats.error} title="Couldn't load statistics" onRetry={() => stats.refetch()} />
      ) : (
        <section aria-label="Statistics" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Documents" value={stats.data?.documents} icon={FileText} loading={stats.isLoading} />
          <StatCard label="Collections" value={stats.data?.collections} icon={FolderOpen} loading={stats.isLoading} />
          <StatCard label="Chunks" value={stats.data?.chunks} icon={Layers} loading={stats.isLoading} />
          <StatCard
            label="Conversations"
            value={stats.data?.conversations}
            icon={MessageSquare}
            loading={stats.isLoading}
          />
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Documents by status</CardTitle>
            <CardDescription>Ingestion pipeline state</CardDescription>
          </CardHeader>
          <CardContent>
            {stats.isLoading ? (
              <div className="grid gap-2">
                {Array.from({ length: 5 }, (_, i) => (
                  <Skeleton key={i} className="h-6" />
                ))}
              </div>
            ) : !byStatus || total === 0 ? (
              <p className="text-sm text-muted-foreground">No documents yet.</p>
            ) : (
              <div className="grid gap-4">
                <div className="flex h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                  {DOCUMENT_STATUSES.map((s) =>
                    byStatus[s] ? (
                      <div key={s} className={STATUS_BAR[s]} style={{ width: `${(byStatus[s] / total) * 100}%` }} />
                    ) : null,
                  )}
                </div>
                <ul className="grid gap-2">
                  {DOCUMENT_STATUSES.map((s) => (
                    <li key={s} className="flex items-center justify-between text-sm">
                      <Link
                        href={`/knowledge-base?status=${s}`}
                        className="rounded outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                      >
                        <StatusBadge status={s} />
                      </Link>
                      <span className="tabular-nums">{byStatus[s] ?? 0}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Recent conversations</CardTitle>
            <CardDescription>Your latest chats here</CardDescription>
          </CardHeader>
          <CardContent>
            {conversations.isLoading ? (
              <div className="grid gap-2">
                {Array.from({ length: 4 }, (_, i) => (
                  <Skeleton key={i} className="h-9" />
                ))}
              </div>
            ) : conversations.error ? (
              <ErrorState error={conversations.error} onRetry={() => conversations.refetch()} />
            ) : (conversations.data ?? []).length === 0 ? (
              <EmptyState
                icon={MessageSquare}
                title="No conversations"
                className="py-6"
                action={
                  <Button size="sm" variant="outline" asChild>
                    <Link href="/chat">
                      <Plus aria-hidden /> Start one
                    </Link>
                  </Button>
                }
              />
            ) : (
              <ul className="grid gap-1">
                {conversations.data!.slice(0, 6).map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/chat/${c.id}`}
                      className="flex items-center justify-between gap-2 rounded-lg px-2 py-2 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                      <span className="truncate">{c.title || "Untitled"}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{formatRelative(c.updatedAt)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            <CardDescription>Latest changes in this workspace</CardDescription>
          </CardHeader>
          <CardContent>
            {activity.isLoading ? (
              <div className="grid gap-2">
                {Array.from({ length: 5 }, (_, i) => (
                  <Skeleton key={i} className="h-8" />
                ))}
              </div>
            ) : activity.error ? (
              <ErrorState error={activity.error} onRetry={() => activity.refetch()} />
            ) : (activity.data ?? []).length === 0 ? (
              <EmptyState icon={ActivityIcon} title="Nothing yet" className="py-6" />
            ) : (
              <ol className="grid max-h-80 gap-3 overflow-y-auto pr-1">
                {activity.data!.slice(0, 20).map((a) => (
                  <li key={a.id} className="text-sm">
                    <p className="leading-snug">{activityText(a)}</p>
                    <time dateTime={a.createdAt} className="text-xs text-muted-foreground">
                      {formatRelative(a.createdAt)}
                    </time>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}
