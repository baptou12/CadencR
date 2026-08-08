import { beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({
  loading: vi.fn(),
  success: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  dismiss: vi.fn(),
}));

vi.mock("sonner", () => ({ toast }));

import {
  dismissStorageMaintenanceToast,
  showStorageMaintenanceToast,
} from "./storage-maintenance-toast";

describe("showStorageMaintenanceToast", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows persistent progress without claiming conversations are deleted", () => {
    showStorageMaintenanceToast({ phase: "started", features: 2, window_days: 30 });

    expect(toast.loading).toHaveBeenCalledWith(
      "Optimizing archived storage…",
      expect.objectContaining({
        id: "storage-maintenance",
        description: expect.stringContaining("conversations and messages are not deleted"),
      }),
    );
  });

  it("replaces progress with a completion toast", () => {
    showStorageMaintenanceToast({ phase: "completed", features: 2, rewritten_messages: 7 });

    expect(toast.success).toHaveBeenCalledWith(
      "Archived storage optimized",
      expect.objectContaining({
        id: "storage-maintenance",
        description: expect.stringContaining("7 oversized tool payloads"),
      }),
    );
  });

  it("replaces progress with a safe retry message after a partial failure", () => {
    showStorageMaintenanceToast({
      phase: "failed",
      completed_features: 2,
      failed_features: 1,
      rewritten_messages: 4,
    });

    expect(toast.error).toHaveBeenCalledWith(
      "Storage optimization incomplete",
      expect.objectContaining({
        id: "storage-maintenance",
        description: expect.stringContaining("will be retried"),
      }),
    );
  });

  it("does not claim success when settings cancel an active sweep", () => {
    showStorageMaintenanceToast({
      phase: "cancelled",
      completed_features: 1,
      remaining_features: 2,
      rewritten_messages: 3,
    });

    expect(toast.info).toHaveBeenCalledWith(
      "Storage optimization stopped",
      expect.objectContaining({
        id: "storage-maintenance",
        description: expect.stringContaining("2 archived conversations left untouched"),
      }),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("surfaces a malformed maintenance event instead of silently ignoring it", () => {
    showStorageMaintenanceToast({ phase: "completed", features: "two" });

    expect(toast.error).toHaveBeenCalledWith("Storage maintenance status could not be read.", {
      id: "storage-maintenance",
    });
  });

  it("can dismiss stale progress when the app socket closes", () => {
    dismissStorageMaintenanceToast();

    expect(toast.dismiss).toHaveBeenCalledWith("storage-maintenance");
  });
});
