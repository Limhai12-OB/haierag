"use client";

import { AlertTriangle, Check, Copy, RefreshCw, RotateCcw, Square, Timer } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatMs, humanize } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Citation } from "@/types/api";
import { CitationCards } from "./citation-cards";
import { MarkdownAnswer } from "./markdown-answer";
import type { RetrievalInfo } from "./use-chat-stream";

export function UserMessage({ content, pending }: { content: string; pending?: boolean }) {
  return (
    <div className="flex justify-end">
      <div
        className={cn(
          "max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3.5 py-2 text-sm whitespace-pre-wrap text-primary-foreground",
          pending && "opacity-80",
        )}
      >
        {content}
      </div>
    </div>
  );
}

/** Pulls retrieval info out of a persisted message's metadata, if the backend stored it. */
export function retrievalFromMetadata(metadata: Record<string, unknown> | undefined): RetrievalInfo | null {
  if (!metadata) return null;
  const r = (metadata.retrieval ?? metadata) as Partial<RetrievalInfo>;
  if (r && typeof r === "object" && r.timingsMs && typeof r.timingsMs === "object") {
    return {
      candidates: typeof r.candidates === "number" ? r.candidates : NaN,
      passages: typeof r.passages === "number" ? r.passages : NaN,
      timingsMs: r.timingsMs as Record<string, number>,
    };
  }
  return null;
}

function RetrievalLine({ meta }: { meta: RetrievalInfo }) {
  const timings = Object.entries(meta.timingsMs ?? {}).filter(([, v]) => typeof v === "number");
  const total = timings.find(([k]) => k.toLowerCase() === "total");
  const parts: string[] = [];
  if (Number.isFinite(meta.candidates) && Number.isFinite(meta.passages)) {
    parts.push(`${meta.candidates} candidates → ${meta.passages} passages`);
  }
  if (total) parts.push(formatMs(total[1]));
  if (parts.length === 0 && timings.length === 0) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded text-[0.7rem] text-muted-foreground/80 outline-none hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <Timer className="size-3" aria-hidden />
          {parts.join(" · ") || "Retrieval timings"}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5">
          {timings.map(([k, v]) => (
            <div key={k} className="contents">
              <dt>{humanize(k)}</dt>
              <dd className="text-right font-mono">{formatMs(v)}</dd>
            </div>
          ))}
        </dl>
      </TooltipContent>
    </Tooltip>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={copied ? "Copied" : "Copy answer"}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard unavailable */
        }
      }}
    >
      {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
    </Button>
  );
}

type AssistantProps = {
  content: string;
  citations: Citation[];
  meta: RetrievalInfo | null;
  state: "complete" | "streaming" | "error" | "stopped" | "failed";
  error?: { code: string; message: string } | null;
  activeMarker?: number | null;
  onCitationClick: (c: Citation) => void;
  onRegenerate?: () => void;
  onRetry?: () => void;
};

export function AssistantMessage({
  content,
  citations,
  meta,
  state,
  error,
  activeMarker,
  onCitationClick,
  onRegenerate,
  onRetry,
}: AssistantProps) {
  const streaming = state === "streaming";
  return (
    <div className="flex flex-col gap-1.5" aria-busy={streaming}>
      {streaming && !content ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <span className="flex gap-1" aria-hidden>
            <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.3s]" />
            <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.15s]" />
            <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground" />
          </span>
          {meta ? "Writing answer…" : "Searching your documents…"}
        </p>
      ) : content ? (
        <div
          className={cn(
            streaming &&
              "after:ml-0.5 after:inline-block after:h-4 after:w-1.5 after:animate-pulse after:bg-foreground/60 after:align-middle",
          )}
        >
          <MarkdownAnswer
            content={content}
            citations={citations}
            onCitationClick={onCitationClick}
            activeMarker={activeMarker}
          />
        </div>
      ) : null}

      {(state === "error" || state === "failed") && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2.5 text-sm"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              {error?.code === "MODEL_UNAVAILABLE" ? "Model unavailable" : "The answer could not be completed"}
            </p>
            <p className="break-words text-muted-foreground">
              {error?.message ?? "Generation failed. You can try regenerating the answer."}
            </p>
          </div>
          {onRetry && (
            <Button variant="outline" size="sm" onClick={onRetry}>
              <RotateCcw aria-hidden /> Retry
            </Button>
          )}
        </div>
      )}
      {state === "stopped" && (
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <Square className="size-3" aria-hidden /> Generation stopped.
        </p>
      )}

      {!streaming && <CitationCards citations={citations} activeMarker={activeMarker} onSelect={onCitationClick} />}

      {!streaming && (
        <div className="flex flex-wrap items-center gap-1">
          {content && <CopyButton text={content} />}
          {onRegenerate && (
            <Button variant="ghost" size="xs" onClick={onRegenerate}>
              <RefreshCw aria-hidden /> Regenerate
            </Button>
          )}
          {meta && <RetrievalLine meta={meta} />}
        </div>
      )}
      {streaming && meta && (
        <div>
          <RetrievalLine meta={meta} />
        </div>
      )}
    </div>
  );
}
