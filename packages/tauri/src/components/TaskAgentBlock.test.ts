import { describe, expect, it } from "vitest";

import { extractTaskOutput } from "@/lib/tool-adapter";

describe("extractTaskOutput", () => {
  it("returns inner task_result content when tags are present", () => {
    expect(
      extractTaskOutput(
        JSON.stringify({
          output: "before<task_result>done</task_result>after",
        }),
      ),
    ).toBe("done");
  });

  it("falls back to the raw output when tags are missing", () => {
    expect(extractTaskOutput(JSON.stringify({ output: "plain output" }))).toBe(
      "plain output",
    );
  });

  it("returns an empty string for malformed json", () => {
    expect(extractTaskOutput("{not json")).toBeUndefined();
  });

  it("returns an empty string for empty or non-string output", () => {
    expect(extractTaskOutput(JSON.stringify({ output: "" }))).toBeUndefined();
    expect(
      extractTaskOutput(JSON.stringify({ output: { value: "nope" } })),
    ).toBeUndefined();
  });
});
