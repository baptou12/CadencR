import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@/test-utils";
import { UsageIndicator } from "./UsageIndicator";
import React from "react";

const { mockGetUsage } = vi.hoisted(() => ({
  mockGetUsage: vi.fn(() => ({ data: undefined, isLoading: true, isError: false })),
}));

vi.mock("@/trpc", () => ({
  trpc: {
    createClient: vi.fn(() => ({})),
    Provider: ({ children, queryClient }: { children: React.ReactNode; queryClient: unknown }) =>
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
    mockGetUsage.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    render(<UsageIndicator />);
    expect(screen.getByText("--")).toBeInTheDocument();
  });

  it("renders error state placeholder", () => {
    mockGetUsage.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    render(<UsageIndicator />);
    expect(screen.getByText("--")).toBeInTheDocument();
  });

  it("renders usage percentages when data is available", () => {
    mockGetUsage.mockReturnValue({
      data: {
        five_hour: { utilization: 42, resets_at: null },
        seven_day: { utilization: 75, resets_at: null },
      } as never,
      isLoading: false,
      isError: false,
    });
    render(<UsageIndicator />);
    expect(screen.getByText(/42%/)).toBeInTheDocument();
    expect(screen.getByText(/75%/)).toBeInTheDocument();
  });
});
