"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Collection, Document } from "@/types/api";

const NONE = "__none__";

export function MoveCollectionDialog({
  doc,
  collections,
  open,
  onOpenChange,
  pending,
  onMove,
}: {
  doc: Document | null;
  collections: Collection[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
  pending: boolean;
  onMove: (collectionId: string | null) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent>
        <MoveForm
          doc={doc}
          collections={collections}
          onCancel={() => onOpenChange(false)}
          pending={pending}
          onMove={onMove}
        />
      </DialogContent>
    </Dialog>
  );
}

function MoveForm({
  doc,
  collections,
  onCancel,
  pending,
  onMove,
}: {
  doc: Document | null;
  collections: Collection[];
  onCancel: () => void;
  pending: boolean;
  onMove: (collectionId: string | null) => void;
}) {
  const [value, setValue] = useState(doc?.collectionId ?? NONE);
  return (
    <>
      <DialogHeader>
        <DialogTitle>Move to collection</DialogTitle>
        <DialogDescription className="truncate">“{doc?.name}”</DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <Label htmlFor="move-collection">Collection</Label>
        <Select value={value} onValueChange={setValue}>
          <SelectTrigger id="move-collection" className="w-full">
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
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button
          onClick={() => onMove(value === NONE ? null : value)}
          disabled={pending || value === (doc?.collectionId ?? NONE)}
        >
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          Move
        </Button>
      </DialogFooter>
    </>
  );
}
