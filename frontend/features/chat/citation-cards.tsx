"use client";

import { FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Citation } from "@/types/api";

export function CitationCards({
  citations,
  activeMarker,
  onSelect,
}: {
  citations: Citation[];
  activeMarker?: number | null;
  onSelect: (c: Citation) => void;
}) {
  if (citations.length === 0) return null;
  const sorted = [...citations].sort((a, b) => a.marker - b.marker);
  return (
    <div className="mt-3">
      <p className="mb-1.5 text-xs font-medium text-muted-foreground">Sources</p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {sorted.map((c) => (
          <li key={`${c.marker}-${c.chunkId ?? c.documentName}`}>
            <button
              type="button"
              onClick={() => onSelect(c)}
              aria-label={`Open source ${c.marker}: ${c.documentName}`}
              className={cn(
                "flex h-full w-full flex-col gap-1 rounded-lg border p-2.5 text-left text-xs transition-colors outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50",
                activeMarker === c.marker && "border-primary/50 bg-muted/60",
              )}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="flex h-4 min-w-4 items-center justify-center rounded bg-primary/10 px-1 text-[0.65rem] font-semibold text-primary">
                  {c.marker}
                </span>
                <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate font-medium">{c.documentName}</span>
                {c.pageNumber !== null && <span className="shrink-0 text-muted-foreground">p. {c.pageNumber}</span>}
              </span>
              {c.sectionHeading && <span className="truncate text-muted-foreground">§ {c.sectionHeading}</span>}
              <span className="line-clamp-2 text-muted-foreground">{c.excerpt}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
