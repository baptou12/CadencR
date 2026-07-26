import { describe, expect, it } from "vitest";
import { DEFAULT_MONO_STACK, resolveMonoStack } from "./constants";

describe("resolveMonoStack", () => {
  it("returns the default stack when family is null", () => {
    expect(resolveMonoStack(null)).toBe(DEFAULT_MONO_STACK);
  });

  it("prepends a quoted family in front of the default stack", () => {
    expect(resolveMonoStack("JetBrains Mono")).toBe(`"JetBrains Mono", ${DEFAULT_MONO_STACK}`);
  });

  it("returns the default stack for an empty string", () => {
    expect(resolveMonoStack("")).toBe(DEFAULT_MONO_STACK);
  });
});
