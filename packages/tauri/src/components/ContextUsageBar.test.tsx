import { describe, expect, it } from "vitest";
import { render, screen } from "@/test-utils";
import { ContextUsageBar } from "./ContextUsageBar";
import type { ContextUsageState } from "@/types/agent";

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
    const { container } = render(<ContextUsageBar usage={null} loaderStyle="normal" isStreaming={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when usage is undefined", () => {
    const { container } = render(<ContextUsageBar usage={undefined} loaderStyle="normal" isStreaming={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("displays usage as percentage", () => {
    render(<ContextUsageBar usage={makeUsage({ usageRatio: 0.05 })} loaderStyle="normal" isStreaming={false} />);
    expect(screen.getByText("5%")).toBeInTheDocument();
  });

  it("displays high usage as percentage", () => {
    render(<ContextUsageBar usage={makeUsage({ usageRatio: 0.75 })} loaderStyle="normal" isStreaming={false} />);
    expect(screen.getByText("75%")).toBeInTheDocument();
  });

  it("renders low usage (green)", () => {
    const { container } = render(<ContextUsageBar usage={makeUsage({ usageRatio: 0.3 })} loaderStyle="normal" isStreaming={false} />);
    expect(container.querySelector(".bg-emerald-500")).toBeInTheDocument();
  });

  it("renders medium usage (yellow)", () => {
    const { container } = render(<ContextUsageBar usage={makeUsage({ usageRatio: 0.6 })} loaderStyle="normal" isStreaming={false} />);
    expect(container.querySelector(".bg-yellow-500")).toBeInTheDocument();
  });

  it("renders high usage (orange)", () => {
    const { container } = render(<ContextUsageBar usage={makeUsage({ usageRatio: 0.85 })} loaderStyle="normal" isStreaming={false} />);
    expect(container.querySelector(".bg-orange-500")).toBeInTheDocument();
  });

  it("renders critical usage (red)", () => {
    const { container } = render(<ContextUsageBar usage={makeUsage({ usageRatio: 0.95 })} loaderStyle="normal" isStreaming={false} />);
    expect(container.querySelector(".bg-red-500")).toBeInTheDocument();
  });

  it("renders usage-glow style when active", () => {
    const { container } = render(<ContextUsageBar usage={makeUsage({ usageRatio: 0.6 })} loaderStyle="usage-glow" isStreaming />);

    expect(container.querySelector(".context-usage-glow")).toBeInTheDocument();
    expect(container.querySelector('[data-loader-style="usage-glow"]')).toBeInTheDocument();
  });

  it("does not animate usage-glow when inactive", () => {
    const { container } = render(<ContextUsageBar usage={makeUsage({ usageRatio: 0.6 })} loaderStyle="usage-glow" isStreaming={false} />);

    expect(container.querySelector(".context-usage-glow")).not.toBeInTheDocument();
  });

  it("does not render bar when totalTokens is 0", () => {
    const { container } = render(
      <ContextUsageBar usage={makeUsage({ totalTokens: 0, usageRatio: 0 })} loaderStyle="normal" isStreaming={false} />
    );
    // Inner bar div should not be rendered
    const bars = container.querySelectorAll(".h-full.rounded-full");
    expect(bars).toHaveLength(0);
  });
});
