import { create } from "zustand";
import { desktopBridge, type UpdateEvent } from "@/lib/desktop-bridge";

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "up-to-date"
  | "error";

interface UpdateState {
  status: UpdateStatus;
  version: string | null;
  releaseNotes: string | null;
  /** Download percent, 0–100. */
  progress: number;
  error: string | null;
  checkForUpdates: () => Promise<void>;
  installUpdate: () => Promise<void>;
  applyEvent: (event: UpdateEvent) => void;
}

export const useUpdateStore = create<UpdateState>((set) => ({
  status: "idle",
  version: null,
  releaseNotes: null,
  progress: 0,
  error: null,
  checkForUpdates: async () => {
    set({ status: "checking", error: null });
    try {
      await desktopBridge.checkForUpdates();
    } catch (err) {
      set({ status: "error", error: err instanceof Error ? err.message : String(err) });
    }
  },
  installUpdate: async () => {
    try {
      await desktopBridge.installUpdate();
    } catch (err) {
      set({ status: "error", error: err instanceof Error ? err.message : String(err) });
    }
  },
  applyEvent: (event) => {
    switch (event.kind) {
      case "checking":
        set({ status: "checking", error: null });
        return;
      case "available":
        set({
          status: "downloading",
          version: event.version,
          releaseNotes: event.releaseNotes,
          progress: 0,
          error: null,
        });
        return;
      case "not-available":
        set({ status: "up-to-date", version: event.version, error: null });
        return;
      case "download-progress":
        set({ status: "downloading", progress: event.percent, error: null });
        return;
      case "downloaded":
        set({ status: "downloaded", version: event.version, progress: 100, error: null });
        return;
      case "error":
        set({ status: "error", error: event.message });
        return;
    }
  },
}));
