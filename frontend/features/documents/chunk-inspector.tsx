"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Layers } from "lucide-react";
import { useState } from "react";
import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { pageLabel } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import { listChunks } from "@/services/documents";

const PAGE_SIZE = 20;

export function ChunkInspector({ documentId, enabled }: { documentId: string; enabled: boolean }) {
  const [page, setPage] = useState(0);
  const chunks = useQuery({
    queryKey: qk.chunks(documentId, page),
    queryFn: () => listChunks(documentId, page, PAGE_SIZE),
    placeholderData: keepPreviousData,
    enabled,
  });

  if (!enabled) {
    return (
      <EmptyState
        icon={Layers}
        title="No chunks yet"
        description="Chunks appear here once the document has been processed."
      />
    );
  }
  if (chunks.isLoading) {
    return (
      <div className="grid gap-3" role="status" aria-label="Loading chunks">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
    );
  }
  if (chunks.error)
    return <ErrorState error={chunks.error} title="Couldn't load chunks" onRetry={() => chunks.refetch()} />;

  const data = chunks.data!;
  if (data.totalElements === 0) {
    return <EmptyState icon={Layers} title="No chunks" description="Processing produced no text for this document." />;
  }

  const pager = (
    <div className="flex items-center justify-between gap-2 text-sm">
      <p className="text-muted-foreground">
        {data.totalElements.toLocaleString()} chunks · page {data.page + 1} of {Math.max(1, data.totalPages)}
      </p>
      <div className="flex gap-1">
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Previous page"
          disabled={page === 0 || chunks.isFetching}
          onClick={() => setPage((p) => Math.max(0, p - 1))}
        >
          <ChevronLeft aria-hidden />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Next page"
          disabled={page + 1 >= data.totalPages || chunks.isFetching}
          onClick={() => setPage((p) => p + 1)}
        >
          <ChevronRight aria-hidden />
        </Button>
      </div>
    </div>
  );

  return (
    <div className="grid gap-3">
      {pager}
      <ol className="grid gap-3" aria-busy={chunks.isFetching}>
        {data.content.map((c) => {
          const pages = pageLabel(c.pageStart, c.pageEnd);
          return (
            <li key={c.id} className="rounded-xl border p-3">
              <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs">
                <Badge variant="secondary">#{c.chunkIndex}</Badge>
                {pages && <Badge variant="outline">{pages}</Badge>}
                <Badge variant="outline">{c.tokenCount} tokens</Badge>
                {c.sectionHeading && (
                  <span className="min-w-0 truncate text-muted-foreground" title={c.sectionHeading}>
                    § {c.sectionHeading}
                  </span>
                )}
              </div>
              <p className="max-h-60 overflow-y-auto text-sm whitespace-pre-wrap text-foreground/90">{c.content}</p>
            </li>
          );
        })}
      </ol>
      {pager}
    </div>
  );
}
