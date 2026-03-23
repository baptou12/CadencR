import { describe, it, expect } from "vitest";
import { PHASE_STATUS_CONFIG } from "./phase-status";

describe("PHASE_STATUS_CONFIG", () => {
  const expectedStatuses = ["draft", "pending", "running", "completed", "done", "error"];

  it("has config for all expected statuses", () => {
    for (const status of expectedStatuses) {
      expect(PHASE_STATUS_CONFIG[status]).toBeDefined();
    }
  });

  it.each(expectedStatuses)("config for '%s' has required fields", (status) => {
    const config = PHASE_STATUS_CONFIG[status];
    expect(config).toHaveProperty("icon");
    expect(config).toHaveProperty("className");
    expect(config).toHaveProperty("badgeClassName");
    expect(config).toHaveProperty("label");
  });

  it("has correct labels", () => {
    expect(PHASE_STATUS_CONFIG.draft.label).toBe("Draft");
    expect(PHASE_STATUS_CONFIG.pending.label).toBe("Pending");
    expect(PHASE_STATUS_CONFIG.running.label).toBe("Running");
    expect(PHASE_STATUS_CONFIG.completed.label).toBe("Completed");
    expect(PHASE_STATUS_CONFIG.done.label).toBe("Done");
    expect(PHASE_STATUS_CONFIG.error.label).toBe("Error");
  });

  it("running status has animate-spin in className", () => {
    expect(PHASE_STATUS_CONFIG.running.className).toContain("animate-spin");
  });

  it("completed and done share the same icon", () => {
    expect(PHASE_STATUS_CONFIG.completed.icon).toBe(PHASE_STATUS_CONFIG.done.icon);
  });

  it("all icons are defined (React components)", () => {
    for (const status of expectedStatuses) {
      expect(PHASE_STATUS_CONFIG[status].icon).toBeDefined();
    }
  });
});
