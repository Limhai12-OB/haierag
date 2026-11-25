"use client";

import { useQuery } from "@tanstack/react-query";
import { FileSearch, FileText, Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { EmptyState, ErrorState, PageHeader } from "@/components/states";
import { statusLabel } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { hasRole } from "@/hooks/use-current-workspace";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { PageContainer } from "@/features/shell/workspace-boundary";
import { qk } from "@/lib/query-keys";
import { listCollections } from "@/services/collections";
import { isInFlight, listDocuments } from "@/services/documents";
import { DOCUMENT_STATUSES, type DocumentStatus, type Workspace } from "@/types/api";
import { CollectionsPanel } from "./collections-panel";
import { DocumentsTable } from "./documents-table";
import { UploadDropzone } from "./upload-dropzone";

const ALL = "__all__";

export function KnowledgeBaseView({ workspace }: { workspace: Workspace }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const collectionId = params.get("collection");
  const statusParam = params.get("status");
  const status = DOCUMENT_STATUSES.includes(statusParam as DocumentStatus) ? (statusParam as DocumentStatus) : null;
  const [search, setSearch] = useState(params.get("q") ?? "");
  const q = useDebouncedValue(search.trim(), 300);
  const canEdit = hasRole(workspace, "MEMBER");

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  useEffect(() => {
    if ((params.get("q") ?? "") !== q) setParam("q", q || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const collections = useQuery({
    queryKey: qk.collections(workspace.id),
    queryFn: () => listCollections(workspace.id),
  });
  const filters = { collectionId, status, q: q || null };
  const documents = useQuery({
    queryKey: qk.documents(workspace.id, filters),
    queryFn: () => listDocuments(workspace.id, filters),
    // Poll while anything is still being ingested so status badges update on their own.
    refetchInterval: (query) => (query.state.data?.some((d) => isInFlight(d.status)) ? 3000 : false),
  });

  const selectedCollection = collections.data?.find((c) => c.id === collectionId) ?? null;
  const filtered = !!(collectionId || status || q);

  return (
    <PageContainer>
      <PageHeader
        title="Knowledge Base"
        description={
          selectedCollection
            ? (selectedCollection.description ?? `Documents in “${selectedCollection.name}”`)
            : "Upload documents and organise them into collections."
        }
      />
      <div className="grid gap-6 lg:grid-cols-[14rem_1fr]">
        <aside>
          <CollectionsPanel
            workspaceId={workspace.id}
            collections={collections.data}
            isLoading={collections.isLoading}
            error={collections.error}
            onRetry={() => collections.refetch()}
            selectedId={collectionId}
            onSelect={(id) => setParam("collection", id)}
            canEdit={canEdit}
          />
        </aside>
        <div className="grid min-w-0 content-start gap-4">
          {canEdit && (
            <UploadDropzone
              workspaceId={workspace.id}
              collections={collections.data ?? []}
              defaultCollectionId={collectionId}
            />
          )}
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Label htmlFor="doc-search" className="sr-only">
                Search documents
              </Label>
              <Search
                className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                id="doc-search"
                type="search"
                placeholder="Search by name…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8"
              />
            </div>
            <Label htmlFor="status-filter" className="sr-only">
              Filter by status
            </Label>
            <Select value={status ?? ALL} onValueChange={(v) => setParam("status", v === ALL ? null : v)}>
              <SelectTrigger id="status-filter" className="w-full sm:w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All statuses</SelectItem>
                {DOCUMENT_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {statusLabel(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {documents.isLoading ? (
            <div className="grid gap-2" role="status" aria-label="Loading documents">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : documents.error ? (
            <ErrorState error={documents.error} title="Couldn't load documents" onRetry={() => documents.refetch()} />
          ) : (documents.data ?? []).length === 0 ? (
            filtered ? (
              <EmptyState
                icon={FileSearch}
                title="No matching documents"
                description="Try a different search, status or collection."
                action={
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSearch("");
                      router.replace(pathname);
                    }}
                  >
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={FileText}
                title="No documents yet"
                description={
                  canEdit
                    ? "Drop files above to start building your knowledge base."
                    : "Members of this workspace haven't uploaded anything yet."
                }
              />
            )
          ) : (
            <DocumentsTable
              workspaceId={workspace.id}
              documents={documents.data!}
              collections={collections.data ?? []}
              canEdit={canEdit}
            />
          )}
        </div>
      </div>
    </PageContainer>
  );
}
