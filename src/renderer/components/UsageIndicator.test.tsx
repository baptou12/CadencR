import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@/test-utils";
import { UsageIndicator } from "./UsageIndicator";
import React from "react";

const { mockGetUsage } = vi.hoisted(() => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockGetUsage: vi.fn((): any => ({ data: undefined, isLoading: true })),
}));

vi.mock("@/trpc", () => ({
  trpc: {
    createClient: vi.fn(() => ({})),
    Provider: ({ children, queryClient: _queryClient }: { children: React.ReactNode; queryClient: unknown }) =>
      React.createElement(React.Fragment, null, children),
    useUtils: vi.fn(() => ({})),
    usage: {
      getUsage: {
        useQuery: mockGetUsage,
      },
    },
  },
}));

describe("UsageIndicator", () => {
  it("renders loading state placeholder", () => {
    mockGetUsage.mockReturnValue({ data: undefined, isLoading: true });
    render(<UsageIndicator />);
    expect(screen.getByText("--")).toBeInTheDocument();
  });

  it("renders error status message when no data", () => {
    mockGetUsage.mockReturnValue({
      data: {
        five_hour: null,
        seven_day: null,
        seven_day_sonnet: null,
        status: "error",
        statusMessage: "No OAuth token",
        retryAt: null,
        updatedAt: Date.now(),
      },
      isLoading: false,
    });
    render(<UsageIndicator />);
    expect(screen.getByText("No OAuth token")).toBeInTheDocument();
    expect(screen.getByText("--")).toBeInTheDocument();
  });

  it("renders usage percentages when data is available", () => {
    mockGetUsage.mockReturnValue({
      data: {
        five_hour: { utilization: 42, resets_at: null },
        seven_day: { utilization: 75, resets_at: null },
        seven_day_sonnet: { utilization: 10, resets_at: null },
        status: "success",
        statusMessage: null,
        retryAt: null,
        updatedAt: Date.now(),
      },
      isLoading: false,
    });
    render(<UsageIndicator />);
    expect(screen.getByText(/42%/)).toBeInTheDocument();
    expect(screen.getByText(/75%/)).toBeInTheDocument();
  });
});
