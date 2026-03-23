import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@/test-utils";
import { UsageIndicator } from "./UsageIndicator";

const { mockUseGetUsageHandler } = vi.hoisted(() => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockUseGetUsageHandler: vi.fn((): any => ({ data: undefined, isLoading: true })),
}));

vi.mock("@/api/generated", () => ({
  useGetUsageHandler: mockUseGetUsageHandler,
}));

describe("UsageIndicator", () => {
  it("renders loading state placeholder", () => {
    mockUseGetUsageHandler.mockReturnValue({ data: undefined, isLoading: true });
    render(<UsageIndicator />);
    expect(screen.getByText("--")).toBeInTheDocument();
  });

  it("renders placeholder when no bucket data", () => {
    mockUseGetUsageHandler.mockReturnValue({
      data: {
        five_hour: null,
        seven_day: null,
        seven_day_sonnet: null,
        status: "error",
        status_message: "No OAuth token",
        retry_at: null,
        updated_at: Date.now(),
      },
      isLoading: false,
    });
    render(<UsageIndicator />);
    expect(screen.getByText("--")).toBeInTheDocument();
  });

  it("renders usage percentages when data is available", () => {
    mockUseGetUsageHandler.mockReturnValue({
      data: {
        five_hour: { utilization: 42, resets_at: null },
        seven_day: { utilization: 75, resets_at: null },
        seven_day_sonnet: { utilization: 10, resets_at: null },
        status: "success",
        status_message: null,
        retry_at: null,
        updated_at: Date.now(),
      },
      isLoading: false,
    });
    render(<UsageIndicator />);
    expect(screen.getByText(/42%/)).toBeInTheDocument();
    expect(screen.getByText(/75%/)).toBeInTheDocument();
  });
});
