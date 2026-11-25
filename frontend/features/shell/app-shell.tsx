"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  BookOpenText,
  FolderOpen,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Settings,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useAuthStore } from "@/lib/auth-store";
import { cn } from "@/lib/utils";
import { logout } from "@/services/auth";
import { WorkspaceSwitcher } from "./workspace-switcher";

type NavItem = { href: string; label: string; icon: LucideIcon; match: string[] };

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, match: ["/dashboard"] },
  { href: "/knowledge-base", label: "Knowledge Base", icon: FolderOpen, match: ["/knowledge-base", "/documents"] },
  { href: "/chat", label: "Chat", icon: MessageSquare, match: ["/chat"] },
  { href: "/settings", label: "Settings", icon: Settings, match: ["/settings"] },
];
const ADMIN_NAV: NavItem = { href: "/admin", label: "Admin", icon: ShieldCheck, match: ["/admin"] };

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join("") || "?"
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const qc = useQueryClient();
  const items = user?.systemRole === "ADMIN" ? [...NAV, ADMIN_NAV] : NAV;

  async function onLogout() {
    await logout();
    qc.clear();
    router.replace("/login");
  }

  return (
    <div className="flex h-full flex-col gap-4 p-3">
      <Link href="/dashboard" className="flex items-center gap-2 px-1.5 pt-1 font-semibold" onClick={onNavigate}>
        <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <BookOpenText className="size-4" aria-hidden />
        </span>
        HaieRag
      </Link>
      <WorkspaceSwitcher />
      <nav aria-label="Main" className="flex-1">
        <ul className="grid gap-0.5">
          {items.map((item) => {
            const active = item.match.some((m) => pathname === m || pathname.startsWith(`${m}/`));
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
                    active && "bg-muted font-medium text-foreground",
                  )}
                >
                  <item.icon className="size-4" aria-hidden />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="flex items-center gap-1 border-t pt-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-auto min-w-0 flex-1 justify-start gap-2 px-1.5 py-1.5">
              <Avatar className="size-7">
                <AvatarFallback className="text-xs">{initials(user?.displayName ?? "")}</AvatarFallback>
              </Avatar>
              <span className="flex min-w-0 flex-col items-start text-left">
                <span className="w-full truncate text-sm">{user?.displayName}</span>
                <span className="w-full truncate text-xs text-muted-foreground">{user?.email}</span>
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-56">
            <DropdownMenuLabel className="truncate">{user?.email}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/settings" onClick={onNavigate}>
                <Settings aria-hidden /> Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onLogout}>
              <LogOut aria-hidden /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <ThemeToggle />
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <div className="flex min-h-svh">
      <a
        href="#main"
        className="sr-only z-50 rounded bg-background px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <aside className="sticky top-0 hidden h-svh w-64 shrink-0 border-r bg-sidebar md:block">
        <SidebarContent />
      </aside>
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-72 bg-sidebar p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">Main navigation and workspace selection</SheetDescription>
          <SidebarContent onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b bg-background/90 px-3 backdrop-blur md:hidden">
          <Button variant="ghost" size="icon" aria-label="Open navigation" onClick={() => setMobileOpen(true)}>
            <Menu aria-hidden />
          </Button>
          <span className="font-semibold">HaieRag</span>
        </header>
        <main id="main" className="flex min-w-0 flex-1 flex-col">
          {children}
        </main>
      </div>
    </div>
  );
}
