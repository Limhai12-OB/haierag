"use client";

import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CITE_HREF_PREFIX, remarkCitations } from "@/lib/citations";
import { cn } from "@/lib/utils";
import type { Citation } from "@/types/api";

type Props = {
  content: string;
  citations: Citation[];
  onCitationClick: (citation: Citation) => void;
  activeMarker?: number | null;
};

export function CitationChip({
  marker,
  citation,
  active,
  onClick,
}: {
  marker: number;
  citation: Citation | undefined;
  active?: boolean;
  onClick: (c: Citation) => void;
}) {
  if (!citation) {
    // Marker without (yet) a matching citation — e.g. while streaming, before the citations event.
    return (
      <span className="mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded bg-muted px-1 align-[0.1em] text-[0.65rem] font-medium text-muted-foreground tabular-nums">
        {marker}
      </span>
    );
  }
  const where = citation.pageNumber !== null ? `, page ${citation.pageNumber}` : "";
  return (
    <button
      type="button"
      data-citation={marker}
      onClick={() => onClick(citation)}
      aria-label={`Source ${marker}: ${citation.documentName}${where}`}
      title={`${citation.documentName}${where}`}
      className={cn(
        "mx-0.5 inline-flex h-4 min-w-4 cursor-pointer items-center justify-center rounded bg-primary/10 px-1 align-[0.1em] text-[0.65rem] font-semibold text-primary tabular-nums outline-none hover:bg-primary/20 focus-visible:ring-2 focus-visible:ring-ring",
        active && "bg-primary text-primary-foreground hover:bg-primary",
      )}
    >
      {marker}
    </button>
  );
}

/**
 * Renders assistant markdown safely: raw HTML is skipped (never injected), URLs go through
 * react-markdown's default sanitising transform, and `[n]` markers become citation chips.
 */
export const MarkdownAnswer = memo(function MarkdownAnswer({
  content,
  citations,
  onCitationClick,
  activeMarker,
}: Props) {
  const byMarker = new Map(citations.map((c) => [c.marker, c]));
  const components: Components = {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    a({ href, children, node, ...rest }) {
      if (href?.startsWith(CITE_HREF_PREFIX)) {
        const marker = Number(href.slice(CITE_HREF_PREFIX.length));
        return (
          <CitationChip
            marker={marker}
            citation={byMarker.get(marker)}
            active={activeMarker === marker}
            onClick={onCitationClick}
          />
        );
      }
      return (
        <a href={href} target="_blank" rel="noopener noreferrer nofollow" {...rest}>
          {children}
        </a>
      );
    },
    img({ alt }) {
      // Don't load remote images from model output.
      return <span className="text-muted-foreground">[image: {alt ?? "omitted"}]</span>;
    },
  };
  return (
    <div className="prose-answer">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkCitations]} skipHtml components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
});
