import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@/test-utils";
import { CopyButton } from "./CopyButton";

const toastErrorMock = vi.hoisted(() => vi.fn());
const writeTextMock = vi.fn().mockResolvedValue(undefined);

vi.mock("sonner", () => ({
  toast: { error: toastErrorMock },
}));

beforeEach(() => {
  writeTextMock.mockClear();
  toastErrorMock.mockClear();
  // jsdom doesn't provide navigator.clipboard by default
  if (!navigator.clipboard) {
    Object.defineProperty(window.navigator, "clipboard", {
      value: { writeText: writeTextMock },
      writable: true,
      configurable: true,
    });
  } else {
    vi.spyOn(navigator.clipboard, "writeText").mockImplementation(writeTextMock);
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CopyButton", () => {
  it("renders a button with copy icon", () => {
    render(<CopyButton text="hello" />);
    expect(screen.getByRole("button", { name: /copy path/i })).toBeInTheDocument();
  });

  it("copies text to clipboard on click", () => {
    render(<CopyButton text="some/path.ts" />);
    fireEvent.click(screen.getByRole("button"));
    expect(writeTextMock).toHaveBeenCalledWith("some/path.ts");
  });

  it("shows check icon after click then reverts", async () => {
    vi.useFakeTimers();
    const { container } = render(<CopyButton text="test" />);

    // Before click: Copy icon
    expect(container.querySelector(".lucide-copy")).toBeInTheDocument();
    expect(container.querySelector(".lucide-check")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button"));

    await act(async () => {
      await Promise.resolve();
    });

    // After click: Check icon
    expect(container.querySelector(".lucide-check")).toBeInTheDocument();
    expect(container.querySelector(".lucide-copy")).not.toBeInTheDocument();

    // After timeout: back to Copy icon
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(container.querySelector(".lucide-copy")).toBeInTheDocument();

    vi.useRealTimers();
  });

  it("accepts custom sizeClass", () => {
    const { container } = render(<CopyButton text="t" sizeClass="h-5 w-5" />);
    const svg = container.querySelector("svg");
    expect(svg?.className.baseVal || svg?.getAttribute("class")).toContain("h-5");
  });

  it("surfaces clipboard failures", async () => {
    writeTextMock.mockRejectedValueOnce(new Error("denied"));
    render(<CopyButton text="t" />);

    fireEvent.click(screen.getByRole("button", { name: /copy path/i }));

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith("Failed to copy to clipboard"));
    expect(screen.getByRole("button", { name: /copy path/i })).toBeInTheDocument();
  });
});
