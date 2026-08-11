import { describe, expect, it, vi } from "vitest";

const ctorSpy = vi.fn();
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    options: Record<string, unknown>;
    constructor(opts: Record<string, unknown>) {
      this.options = opts;
      ctorSpy(opts);
    }
  },
}));

import { createXtermInstance } from "@/components/terminal/createXtermInstance";
import { DEFAULT_MONO_STACK } from "@/lib/fonts/constants";

const theme = {} as never;

describe("createXtermInstance", () => {
  it("uses the provided fontFamily", () => {
    createXtermInstance(theme, `"Fira Code", ${DEFAULT_MONO_STACK}`);
    expect(ctorSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ fontFamily: `"Fira Code", ${DEFAULT_MONO_STACK}` }),
    );
  });

  it("falls back to DEFAULT_MONO_STACK when fontFamily is omitted", () => {
    createXtermInstance(theme);
    expect(ctorSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ fontFamily: DEFAULT_MONO_STACK }),
    );
  });
});
