"use client";

import { DashboardView } from "@/features/dashboard/dashboard-view";
import { WorkspaceBoundary } from "@/features/shell/workspace-boundary";

export default function DashboardPage() {
  return <WorkspaceBoundary>{(ws) => <DashboardView key={ws.id} workspace={ws} />}</WorkspaceBoundary>;
}
