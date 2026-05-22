import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { render, screen } from "@/test-utils";
import { CollapsibleSection } from "./collapsible-section";

describe("CollapsibleSection", () => {
  beforeEach(() => {
    // Default to "animations on" so the rAF/timer path runs.
    document.documentElement.dataset.animations = "on";
  });

  afterEach(() => {
    delete document.documentElement.dataset.animations;
  });

  it("renders nothing when open=false on first mount", () => {
    render(
      <CollapsibleSection open={false}>
        <div data-testid="body">body</div>
      </CollapsibleSection>,
    );
    expect(screen.queryByTestId("body")).not.toBeInTheDocument();
  });

  it("renders children immediately when open=true on first mount", () => {
    render(
      <CollapsibleSection open={true}>
        <div data-testid="body">body</div>
      </CollapsibleSection>,
    );
    expect(screen.getByTestId("body")).toBeInTheDocument();
  });

  it("mounts and reveals when flipped from closed to open", async () => {
    const { rerender } = render(
      <CollapsibleSection open={false}>
        <div data-testid="body">body</div>
      </CollapsibleSection>,
    );
    expect(screen.queryByTestId("body")).not.toBeInTheDocument();

    await act(async () => {
      rerender(
        <CollapsibleSection open={true}>
          <div data-testid="body">body</div>
        </CollapsibleSection>,
      );
      // Two rAFs need to flush before the grid-rows-[1fr] class applies.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });

    expect(screen.getByTestId("body")).toBeInTheDocument();
  });

  it("snaps without animation when the global kill-switch is off", () => {
    document.documentElement.dataset.animations = "off";
    const { rerender } = render(
      <CollapsibleSection open={false}>
        <div data-testid="body">body</div>
      </CollapsibleSection>,
    );
    act(() => {
      rerender(
        <CollapsibleSection open={true}>
          <div data-testid="body">body</div>
        </CollapsibleSection>,
      );
    });
    // No rAF flush needed — the kill-switch path sets visible synchronously.
    expect(screen.getByTestId("body")).toBeInTheDocument();
  });
});
