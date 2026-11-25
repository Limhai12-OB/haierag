"use client";

import { useEffect } from "react";
import { refreshSession } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";

let bootstrapped = false;

/** On first load, try to restore the session from the httpOnly refresh cookie. */
export function AuthBootstrap() {
  useEffect(() => {
    if (bootstrapped || useAuthStore.getState().status !== "loading") return;
    bootstrapped = true;
    void refreshSession();
  }, []);
  return null;
}
