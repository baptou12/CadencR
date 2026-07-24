import { describe, expect, it } from "vitest";
import { reviewStateLabel } from "./FeaturePrView";

describe("reviewStateLabel", () => {
  it("hides the provider's absence-of-review sentinel", () => {
    expect(reviewStateLabel("none")).toBeNull();
  });

  it("uses user-facing labels for actionable review states", () => {
    expect(reviewStateLabel("approved")).toBe("approved");
    expect(reviewStateLabel("changes_requested")).toBe("changes requested");
    expect(reviewStateLabel("pending")).toBe("review pending");
  });
});
