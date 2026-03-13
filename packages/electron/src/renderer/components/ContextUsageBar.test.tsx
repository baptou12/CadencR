import { describe, it, expect } from "vitest";
import { render, screen } from "@/test-utils";
import { ContextUsageBar } from "./ContextUsageBar";
import type { ContextUsageState } from "@/hooks/useContextUsage";

function makeUsage(overrides: Partial<ContextUsageState> = {}): ContextUsageState {
  return {
    inputTokens: 10000,
    outputTokens: 0,
    totalTokens: 10000,
    contextWindow: 200000,
    usageRatio: 0.05,
    wasCompacted: false,
    ...overrides,
  };
}

describe("ContextUsageBar", () => {
  it("renders nothing when usage is null", () => {
    const { container } = render(<ContextUsageBar usage={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when usage is undefined", () => {
    const { container } = render(<ContextUsageBar usage={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it("displays usage as percentage", () => {
    render(<ContextUsageBar usage={makeUsage({ usageRatio: 0.05 })} />);
    expect(screen.getByText("5%")).toBeInTheDocument();
  });

  it("displays high usage as percentage", () => {
    render(<ContextUsageBar usage={makeUsage({ usageRatio: 0.75 })} />);
    expect(screen.getByText("75%")).toBeInTheDocument();
  });

  it("renders low usage (green)", () => {
    const { container } = render(<ContextUsageBar usage={makeUsage({ usageRatio: 0.3 })} />);
    expect(container.querySelector(".bg-emerald-500")).toBeInTheDocument();
  });

  it("renders medium usage (yellow)", () => {
    const { container } = render(<ContextUsageBar usage={makeUsage({ usageRatio: 0.6 })} />);
    expect(container.querySelector(".bg-yellow-500")).toBeInTheDocument();
  });

  it("renders high usage (orange)", () => {
    const { container } = render(<ContextUsageBar usage={makeUsage({ usageRatio: 0.85 })} />);
    expect(container.querySelector(".bg-orange-500")).toBeInTheDocument();
  });

  it("renders critical usage (red)", () => {
    const { container } = render(<ContextUsageBar usage={makeUsage({ usageRatio: 0.95 })} />);
    expect(container.querySelector(".bg-red-500")).toBeInTheDocument();
  });

  it("does not render bar when totalTokens is 0", () => {
    const { container } = render(
      <ContextUsageBar usage={makeUsage({ totalTokens: 0, usageRatio: 0 })} />
    );
    // Inner bar div should not be rendered
    const bars = container.querySelectorAll(".h-full.rounded-full");
    expect(bars).toHaveLength(0);
  });
});
