import { describe, expect, it } from "vitest";
import { render, screen } from "@/test-utils";
import { FeatureWorkspaceSkeleton } from "./FeatureWorkspaceSkeleton";

describe("FeatureWorkspaceSkeleton", () => {
  it("exposes an announced loading status (explicit-state contract)", () => {
    render(<FeatureWorkspaceSkeleton />);
    // `role="status"` gives an aria-live region so assistive tech announces the
    // brief feature-switch wait instead of leaving it silent.
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status).toHaveAccessibleName("Loading conversation");
  });

  it("fills its container so it doesn't collapse the workspace region", () => {
    render(<FeatureWorkspaceSkeleton />);
    expect(screen.getByRole("status")).toHaveClass("h-full");
  });
});
