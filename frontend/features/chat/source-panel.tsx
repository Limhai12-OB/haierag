"use client";

import { ExternalLink, FileText, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { formatScore } from "@/lib/format";
import type { Citation } from "@/types/api";

/**
 * Non-modal side panel showing a citation's source passage. Docked on large screens,
 * overlaid on small ones. Esc closes it.
 */
export function SourcePanel({ citation, onClose }: { citation: Citation; onClose: () => void }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, [citation]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <aside
      aria-label="Source preview"
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l bg-background shadow-xl lg:static lg:z-auto lg:w-96 lg:max-w-none lg:shrink-0 lg:shadow-none"
    >
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <h2 ref={headingRef} tabIndex={-1} className="text-sm font-semibold outline-none">
          Source [{citation.marker}]
        </h2>
        <Button variant="ghost" size="icon-sm" aria-label="Close source preview" onClick={onClose}>
          <X aria-hidden />
        </Button>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <div className="flex items-start gap-2">
          <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0">
            <p className="font-medium break-words">{citation.documentName}</p>
            <p className="text-xs text-muted-foreground">
              {citation.pageNumber !== null ? `Page ${citation.pageNumber}` : "Page n/a"}
              {citation.sectionHeading && ` · ${citation.sectionHeading}`}
            </p>
          </div>
        </div>
        <blockquote className="rounded-lg border-l-2 border-primary/40 bg-muted/50 p-3 text-sm whitespace-pre-wrap">
          {citation.excerpt}
        </blockquote>
        <dl className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <dt className="text-muted-foreground">Retrieval score</dt>
            <dd className="font-mono">{formatScore(citation.retrievalScore)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Rerank score</dt>
            <dd className="font-mono">{formatScore(citation.rerankScore)}</dd>
          </div>
        </dl>
        {citation.documentId && (
          <Button variant="outline" size="sm" asChild>
            <Link href={`/documents/${citation.documentId}`}>
              <ExternalLink aria-hidden /> Open document
            </Link>
          </Button>
        )}
      </div>
    </aside>
  );
}
