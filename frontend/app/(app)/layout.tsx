"use client";

import { AuthGuard } from "@/features/auth/auth-guard";
import { AppShell } from "@/features/shell/app-shell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <AppShell>{children}</AppShell>
    </AuthGuard>
  );
}
