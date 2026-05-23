import { describe, it, expect, vi, beforeEach } from "vitest";

const calls = {
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  default: vi.fn(),
};
vi.mock("sonner", () => {
  const fn = (...args: unknown[]) => calls.default(...args);
  return {
    toast: Object.assign(fn, {
      error: (...args: unknown[]) => calls.error(...args),
      warning: (...args: unknown[]) => calls.warning(...args),
      info: (...args: unknown[]) => calls.info(...args),
    }),
  };
});

import { buildLspNotificationHandlers } from "./notifications";

describe("LSP notification handlers", () => {
  beforeEach(() => {
    calls.error.mockClear();
    calls.warning.mockClear();
    calls.info.mockClear();
    calls.default.mockClear();
  });

  it("routes showMessage Error to toast.error and reports handled", () => {
    const handlers = buildLspNotificationHandlers();
    const handled = handlers["window/showMessage"](null, { type: 1, message: "boom" });
    expect(handled).toBe(true);
    expect(calls.error).toHaveBeenCalledWith("boom");
  });

  it("routes showMessage Warning to toast.warning", () => {
    const handlers = buildLspNotificationHandlers();
    handlers["window/showMessage"](null, { type: 2, message: "be careful" });
    expect(calls.warning).toHaveBeenCalledWith("be careful");
  });

  it("routes showMessage Info to toast.info", () => {
    const handlers = buildLspNotificationHandlers();
    handlers["window/showMessage"](null, { type: 3, message: "fyi" });
    expect(calls.info).toHaveBeenCalledWith("fyi");
  });

  it("logMessage Error still pops a toast — actionable for the user", () => {
    const handlers = buildLspNotificationHandlers();
    handlers["window/logMessage"](null, { type: 1, message: "cargo check failed" });
    expect(calls.error).toHaveBeenCalledWith("cargo check failed");
  });

  it("logMessage Info is quiet (console only) so we don't spam toasts", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const handlers = buildLspNotificationHandlers();
    handlers["window/logMessage"](null, { type: 3, message: "indexing 23%" });
    expect(calls.info).not.toHaveBeenCalled();
    expect(debugSpy).toHaveBeenCalled();
    debugSpy.mockRestore();
  });

  it("returns false (fall back to library default) when params are malformed", () => {
    const handlers = buildLspNotificationHandlers();
    expect(handlers["window/showMessage"](null, { type: 1 })).toBe(false);
    expect(handlers["window/showMessage"](null, null)).toBe(false);
  });
});
