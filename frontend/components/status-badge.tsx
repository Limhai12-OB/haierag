import { CheckCircle2, CircleDashed, Clock, Loader2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DocumentStatus } from "@/types/api";

const STYLES: Record<DocumentStatus, { label: string; className: string; Icon: typeof Clock; spin?: boolean }> = {
  UPLOADED: { label: "Uploaded", className: "bg-muted text-muted-foreground", Icon: CircleDashed },
  QUEUED: {
    label: "Queued",
    className: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
    Icon: Clock,
  },
  PROCESSING: {
    label: "Processing",
    className: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
    Icon: Loader2,
    spin: true,
  },
  COMPLETED: {
    label: "Ready",
    className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    Icon: CheckCircle2,
  },
  FAILED: { label: "Failed", className: "bg-destructive/10 text-destructive", Icon: XCircle },
};

export function statusLabel(status: DocumentStatus) {
  return STYLES[status]?.label ?? status;
}

export function StatusBadge({ status, className }: { status: DocumentStatus; className?: string }) {
  const s = STYLES[status] ?? STYLES.UPLOADED;
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-full px-2 text-xs font-medium whitespace-nowrap",
        s.className,
        className,
      )}
    >
      <s.Icon className={cn("size-3", s.spin && "animate-spin motion-reduce:animate-none")} aria-hidden />
      {s.label}
    </span>
  );
}
