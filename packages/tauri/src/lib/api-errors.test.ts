import { describe, expect, it } from "vitest";
import { apiErrorMessage } from "./api-errors";

describe("apiErrorMessage", () => {
  it("uses backend JSON error messages from Axios errors", () => {
    const err = {
      isAxiosError: true,
      response: { data: { error: "Bad request: target branch worktree has uncommitted changes" } },
    };

    expect(apiErrorMessage(err, "Fallback")).toBe(
      "Bad request: target branch worktree has uncommitted changes",
    );
  });

  it("falls back to Error messages when there is no backend JSON error", () => {
    expect(apiErrorMessage(new Error("network down"), "Fallback")).toBe("network down");
  });

  it("uses the fallback when no useful message is available", () => {
    expect(apiErrorMessage({ isAxiosError: true, response: { data: {} } }, "Fallback")).toBe(
      "Fallback",
    );
  });
});
