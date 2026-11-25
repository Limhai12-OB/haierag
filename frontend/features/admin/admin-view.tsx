"use client";

import { useQuery } from "@tanstack/react-query";
import { ShieldAlert, Users, Workflow } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { EmptyState, ErrorState, PageHeader } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageContainer } from "@/features/shell/workspace-boundary";
import { useAuthStore } from "@/lib/auth-store";
import { formatDateTime, formatRelative, humanize } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import { listAdminJobs, listAdminUsers } from "@/services/system";

const JOB_STATUSES = ["QUEUED", "PROCESSING", "COMPLETED", "FAILED"];
const ALL = "__all__";

function jobBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  const s = status.toUpperCase();
  if (s === "FAILED") return "destructive";
  if (s === "COMPLETED") return "secondary";
  return "outline";
}

function TableSkeleton() {
  return (
    <div className="grid gap-2">
      {Array.from({ length: 5 }, (_, i) => (
        <Skeleton key={i} className="h-10" />
      ))}
    </div>
  );
}

export function AdminView() {
  const isAdmin = useAuthStore((s) => s.user?.systemRole === "ADMIN");
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const users = useQuery({ queryKey: qk.adminUsers, queryFn: listAdminUsers, enabled: isAdmin });
  const jobs = useQuery({
    queryKey: qk.adminJobs(jobStatus),
    queryFn: () => listAdminJobs(jobStatus),
    enabled: isAdmin,
    refetchInterval: 10_000,
  });

  if (!isAdmin) {
    return (
      <PageContainer>
        <EmptyState icon={ShieldAlert} title="Administrators only" description="You don't have access to this page." />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader title="Administration" description="Users and ingestion jobs across all workspaces." />

      <Card>
        <CardHeader>
          <CardTitle>Users</CardTitle>
          <CardDescription>
            {users.data ? `${users.data.length} registered` : "All registered accounts"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {users.isLoading ? (
            <TableSkeleton />
          ) : users.error ? (
            <ErrorState error={users.error} onRetry={() => users.refetch()} />
          ) : users.data!.length === 0 ? (
            <EmptyState icon={Users} title="No users" />
          ) : (
            <div className="overflow-hidden rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead className="hidden sm:table-cell">Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead className="hidden md:table-cell">Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.data!.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell className="max-w-[12rem]">
                        <p className="truncate font-medium">{u.displayName}</p>
                        <p className="truncate text-xs text-muted-foreground sm:hidden">{u.email}</p>
                      </TableCell>
                      <TableCell className="hidden max-w-[16rem] truncate sm:table-cell">{u.email}</TableCell>
                      <TableCell>
                        <Badge variant={u.systemRole === "ADMIN" ? "default" : "secondary"}>
                          {u.systemRole === "ADMIN" ? "Admin" : "User"}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">
                        {formatDateTime(u.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent processing jobs</CardTitle>
          <CardDescription>Refreshes every 10 s.</CardDescription>
          <CardAction>
            <Label htmlFor="job-status" className="sr-only">
              Filter jobs by status
            </Label>
            <Select value={jobStatus ?? ALL} onValueChange={(v) => setJobStatus(v === ALL ? null : v)}>
              <SelectTrigger id="job-status" size="sm" className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All statuses</SelectItem>
                {JOB_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {humanize(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardAction>
        </CardHeader>
        <CardContent>
          {jobs.isLoading ? (
            <TableSkeleton />
          ) : jobs.error ? (
            <ErrorState error={jobs.error} onRetry={() => jobs.refetch()} />
          ) : jobs.data!.length === 0 ? (
            <EmptyState icon={Workflow} title="No jobs" description="No processing jobs match this filter." />
          ) : (
            <div className="overflow-hidden rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Document</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden sm:table-cell">Stage</TableHead>
                    <TableHead className="hidden md:table-cell">Attempts</TableHead>
                    <TableHead className="hidden lg:table-cell">Started</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobs.data!.map((j) => (
                    <TableRow key={j.id}>
                      <TableCell className="max-w-[16rem]">
                        {j.documentId ? (
                          <Link
                            href={`/documents/${j.documentId}`}
                            className="block truncate font-medium hover:underline"
                          >
                            {j.documentName ?? j.documentId}
                          </Link>
                        ) : (
                          <span className="block truncate font-mono text-xs">{j.id}</span>
                        )}
                        {j.errorMessage && (
                          <p className="truncate text-xs text-destructive" title={j.errorMessage}>
                            {j.errorMessage}
                          </p>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={jobBadgeVariant(j.status)}>{humanize(j.status)}</Badge>
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground sm:table-cell">
                        {j.stage ? humanize(j.stage) : "—"}
                      </TableCell>
                      <TableCell className="hidden tabular-nums md:table-cell">{j.attempts ?? "—"}</TableCell>
                      <TableCell className="hidden text-muted-foreground lg:table-cell">
                        {formatRelative(j.startedAt ?? j.createdAt ?? null)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
