"use client";

import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { humanize } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { getSystemHealth } from "@/services/system";
import type { AiHealth, BackendComponentHealth } from "@/types/api";

type Level = "ok" | "degraded" | "down" | "unknown";

function level(status: string | undefined | null): Level {
  const s = (status ?? "").toLowerCase();
  if (["ok", "up", "healthy"].includes(s)) return "ok";
  if (["degraded", "warn", "warning", "partial"].includes(s)) return "degraded";
  if (["down", "error", "unavailable", "out_of_service", "fail", "failed"].includes(s)) return "down";
  return "unknown";
}

const LEVEL_STYLE: Record<Level, { dot: string; label: string }> = {
  ok: { dot: "bg-emerald-500", label: "Healthy" },
  degraded: { dot: "bg-amber-500", label: "Degraded" },
  down: { dot: "bg-destructive", label: "Down" },
  unknown: { dot: "bg-muted-foreground", label: "Unknown" },
};

function normalize(v: BackendComponentHealth | undefined): { status: string; detail?: string } {
  if (v === undefined || v === null) return { status: "unknown" };
  if (typeof v === "string") return { status: v };
  return { status: String(v.status ?? "unknown"), detail: typeof v.detail === "string" ? v.detail : undefined };
}

function isAiHealth(v: unknown): v is AiHealth {
  return !!v && typeof v === "object" && "components" in v && typeof (v as AiHealth).components === "object";
}

function Row({ name, status, detail }: { name: string; status: string; detail?: string }) {
  const l = level(status);
  return (
    <li className="flex items-start gap-3 py-2.5">
      <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", LEVEL_STYLE[l].dot)} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{name}</p>
        {detail && <p className="text-xs break-words text-muted-foreground">{detail}</p>}
      </div>
      <span className="shrink-0 text-xs text-muted-foreground">
        {LEVEL_STYLE[l].label}
        <span className="sr-only"> ({status})</span>
      </span>
    </li>
  );
}

const AI_ORDER = ["ollama", "llm", "embedding", "reranker", "postgres", "redis", "storage"];
const AI_LABELS: Record<string, string> = {
  ollama: "Ollama",
  llm: "LLM (generation)",
  embedding: "Embedding model",
  reranker: "Reranker",
  postgres: "PostgreSQL (AI service)",
  redis: "Redis (AI service)",
  storage: "Object storage (AI service)",
};

export function SystemHealth() {
  const health = useQuery({ queryKey: qk.health, queryFn: getSystemHealth, refetchInterval: 30_000, retry: false });
  const h = health.data;
  const ai = h?.aiService;

  return (
    <Card>
      <CardHeader>
        <CardTitle>System health</CardTitle>
        <CardDescription>Status of the backend and AI components. Refreshes every 30 s.</CardDescription>
        <CardAction>
          <Button
            variant="outline"
            size="sm"
            onClick={() => health.refetch()}
            disabled={health.isFetching}
            aria-label="Refresh health"
          >
            <RefreshCw className={cn(health.isFetching && "animate-spin")} aria-hidden /> Refresh
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {health.isLoading ? (
          <div className="grid gap-2">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-9" />
            ))}
          </div>
        ) : health.error ? (
          <ErrorState error={health.error} title="Health check failed" onRetry={() => health.refetch()} />
        ) : (
          <div className="grid gap-6 md:grid-cols-2">
            <section aria-labelledby="health-core">
              <h3 id="health-core" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Core services
              </h3>
              <ul className="divide-y">
                <Row name="Backend API" {...normalize(h!.backend)} />
                <Row name="Database" {...normalize(h!.database)} />
                <Row name="Redis" {...normalize(h!.redis)} />
                <Row name="Object storage" {...normalize(h!.storage)} />
              </ul>
            </section>
            <section aria-labelledby="health-ai">
              <h3 id="health-ai" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                AI service {isAiHealth(ai) && <>· {LEVEL_STYLE[level(ai.status)].label.toLowerCase()}</>}
              </h3>
              {isAiHealth(ai) ? (
                <ul className="divide-y">
                  {Object.entries(ai.components)
                    .sort(([a], [b]) => {
                      const ia = AI_ORDER.indexOf(a);
                      const ib = AI_ORDER.indexOf(b);
                      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
                    })
                    .map(([k, c]) => (
                      <Row
                        key={k}
                        name={AI_LABELS[k] ?? humanize(k)}
                        status={String(c?.status ?? "unknown")}
                        detail={c?.detail}
                      />
                    ))}
                </ul>
              ) : (
                <ul className="divide-y">
                  <Row name="AI service" {...normalize(ai as BackendComponentHealth | undefined)} />
                </ul>
              )}
            </section>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
