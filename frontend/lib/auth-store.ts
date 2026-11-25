import { create } from "zustand";
import type { AuthResponse, User } from "@/types/api";

export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

type AuthState = {
  status: AuthStatus;
  /** Access token lives only in memory — never persisted. */
  accessToken: string | null;
  user: User | null;
  setSession: (auth: AuthResponse) => void;
  setUser: (user: User) => void;
  clear: () => void;
};

export const useAuthStore = create<AuthState>()((set) => ({
  status: "loading",
  accessToken: null,
  user: null,
  setSession: (auth) => set({ status: "authenticated", accessToken: auth.accessToken, user: auth.user }),
  setUser: (user) => set({ user }),
  clear: () => set({ status: "unauthenticated", accessToken: null, user: null }),
}));
