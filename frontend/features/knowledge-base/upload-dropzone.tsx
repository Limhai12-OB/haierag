"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, FileUp, Loader2, X, XCircle } from "lucide-react";
import { useCallback, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { errorMessage } from "@/lib/api-client";
import { formatBytes } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import { ACCEPT_ATTR, ALLOWED_EXTENSIONS, MAX_UPLOAD_MB, validateUploadFile } from "@/lib/upload-validation";
import { cn } from "@/lib/utils";
import { uploadDocument } from "@/services/documents";
import type { Collection } from "@/types/api";

type UploadItem = {
  key: string;
  name: string;
  size: number;
  state: "invalid" | "uploading" | "done" | "error";
  message?: string;
};

const NONE = "__none__";

type Props = {
  workspaceId: string;
  collections: Collection[];
  defaultCollectionId: string | null;
  /** Injected in tests. */
  upload?: typeof uploadDocument;
};

export function UploadDropzone({ workspaceId, collections, defaultCollectionId, upload = uploadDocument }: Props) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [collectionChoice, setCollectionChoice] = useState<string | null>(null);
  const collectionId =
    collectionChoice === null ? defaultCollectionId : collectionChoice === NONE ? null : collectionChoice;
  const selectId = useId();

  const update = (key: string, patch: Partial<UploadItem>) =>
    setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  const handleFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const files = Array.from(fileList);
      const queued: { item: UploadItem; file: File }[] = [];
      const newItems: UploadItem[] = files.map((file) => {
        const key = `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`;
        const v = validateUploadFile(file);
        const item: UploadItem = v.ok
          ? { key, name: file.name, size: file.size, state: "uploading" }
          : { key, name: file.name, size: file.size, state: "invalid", message: v.reason };
        if (v.ok) queued.push({ item, file });
        return item;
      });
      setItems((list) => [...newItems, ...list].slice(0, 30));

      // Upload with small concurrency so large batches don't saturate the backend.
      const worker = async () => {
        while (queued.length) {
          const { item, file } = queued.shift()!;
          try {
            await upload(workspaceId, file, collectionId);
            update(item.key, { state: "done", message: "Queued for processing" });
          } catch (err) {
            update(item.key, { state: "error", message: errorMessage(err, "Upload failed") });
          }
        }
      };
      if (queued.length) {
        await Promise.all([worker(), worker()]);
        qc.invalidateQueries({ queryKey: qk.documents(workspaceId) });
        qc.invalidateQueries({ queryKey: qk.collections(workspaceId) });
        qc.invalidateQueries({ queryKey: qk.stats(workspaceId) });
        qc.invalidateQueries({ queryKey: qk.activity(workspaceId) });
      }
    },
    [upload, workspaceId, collectionId, qc],
  );

  return (
    <section aria-label="Upload documents" className="grid gap-3">
      <div
        onDragEnter={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length) void handleFiles(e.dataTransfer.files);
        }}
        data-testid="dropzone"
        className={cn(
          "flex flex-col items-center gap-3 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors sm:flex-row sm:text-left",
          dragging ? "border-primary bg-primary/5" : "border-border",
        )}
      >
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted">
          <FileUp className="size-5 text-muted-foreground" aria-hidden />
        </div>
        <div className="flex-1 space-y-0.5">
          <p className="text-sm font-medium">Drag & drop files here, or browse</p>
          <p className="text-xs text-muted-foreground">
            {ALLOWED_EXTENSIONS.map((e) => e.toUpperCase()).join(", ")} · up to {MAX_UPLOAD_MB} MB each
          </p>
        </div>
        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
          <Label htmlFor={selectId} className="sr-only">
            Upload into collection
          </Label>
          <Select value={collectionId ?? NONE} onValueChange={setCollectionChoice}>
            <SelectTrigger id={selectId} className="w-full sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>No collection</SelectItem>
              {collections.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" onClick={() => inputRef.current?.click()}>
            Browse files
          </Button>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT_ATTR}
          className="sr-only"
          tabIndex={-1}
          aria-label="Choose files to upload"
          onChange={(e) => {
            if (e.target.files?.length) void handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {items.length > 0 && (
        <div className="rounded-xl border">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <p className="text-xs font-medium text-muted-foreground">Uploads</p>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setItems((l) => l.filter((i) => i.state === "uploading"))}
              disabled={items.every((i) => i.state === "uploading")}
            >
              Clear finished
            </Button>
          </div>
          <ul className="max-h-56 divide-y overflow-y-auto" aria-live="polite">
            {items.map((i) => (
              <li key={i.key} className="flex items-center gap-3 px-3 py-2 text-sm">
                {i.state === "uploading" && (
                  <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-label="Uploading" />
                )}
                {i.state === "done" && (
                  <CheckCircle2 className="size-4 shrink-0 text-emerald-600" aria-label="Uploaded" />
                )}
                {(i.state === "error" || i.state === "invalid") && (
                  <XCircle className="size-4 shrink-0 text-destructive" aria-label="Failed" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate">{i.name}</p>
                  {i.message && (
                    <p className={cn("text-xs", i.state === "done" ? "text-muted-foreground" : "text-destructive")}>
                      {i.message}
                    </p>
                  )}
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(i.size)}</span>
                {i.state !== "uploading" && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Dismiss ${i.name}`}
                    onClick={() => setItems((l) => l.filter((x) => x.key !== i.key))}
                  >
                    <X aria-hidden />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
