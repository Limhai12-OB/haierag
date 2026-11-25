import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

type SessionState = {
  /** Last selected workspace (not sensitive; persisted so reloads keep the selection). */
  currentWorkspaceId: string | null;
  setCurrentWorkspaceId: (id: string | null) => void;
};

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      currentWorkspaceId: null,
      setCurrentWorkspaceId: (id) => set({ currentWorkspaceId: id }),
    }),
    {
      name: "haierag.session",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ currentWorkspaceId: s.currentWorkspaceId }),
    },
  ),
);
