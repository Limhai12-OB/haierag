"use client";

import { Suspense } from "react";
import { KnowledgeBaseView } from "@/features/knowledge-base/knowledge-base-view";
import { WorkspaceBoundary } from "@/features/shell/workspace-boundary";

export default function KnowledgeBasePage() {
  return (
    <Suspense>
      <WorkspaceBoundary>{(ws) => <KnowledgeBaseView key={ws.id} workspace={ws} />}</WorkspaceBoundary>
    </Suspense>
  );
}
