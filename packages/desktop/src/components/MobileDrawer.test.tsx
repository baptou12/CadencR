import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@/test-utils";
import { MobileDrawer } from "./MobileDrawer";

describe("MobileDrawer", () => {
  it("dismisses via the backdrop", async () => {
    const onClose = vi.fn();
    const { user } = render(
      <MobileDrawer collapsed={false} onClose={onClose} closeLabel="Close menu">
        <div>drawer body</div>
      </MobileDrawer>,
    );

    await user.click(screen.getByRole("button", { name: "Close menu" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("slides the panel off-canvas and disables the backdrop when collapsed", () => {
    const { rerender } = render(
      <MobileDrawer collapsed={false} onClose={vi.fn()} closeLabel="Close menu">
        <div data-testid="body">drawer body</div>
      </MobileDrawer>,
    );

    const panel = screen.getByTestId("body").parentElement as HTMLElement;
    const backdrop = screen.getByRole("button", { name: "Close menu" });
    expect(panel.className).toContain("translate-x-0");
    expect(backdrop.className).toContain("opacity-100");

    rerender(
      <MobileDrawer collapsed onClose={vi.fn()} closeLabel="Close menu">
        <div data-testid="body">drawer body</div>
      </MobileDrawer>,
    );

    expect(panel.className).toContain("-translate-x-full");
    expect(backdrop.className).toContain("pointer-events-none");
  });

  describe("swipe gestures", () => {
    /** Returns whether the browser's own gesture was cancelled at touchstart. */
    function swipe(el: HTMLElement, points: Array<[number, number]>): boolean {
      const touches = ([clientX, clientY]: [number, number]) => ({
        touches: [{ clientX, clientY }],
      });
      const [start, ...moves] = points;
      const notPrevented = fireEvent.touchStart(el, touches(start));
      for (const point of moves) fireEvent.touchMove(el, touches(point));
      fireEvent.touchEnd(el, { touches: [] });
      return !notPrevented;
    }

    function edgeStrip(): HTMLElement {
      return document.querySelector("[data-drawer-edge-swipe]") as HTMLElement;
    }

    function panel(): HTMLElement {
      return document.querySelector("[data-drawer-panel]") as HTMLElement;
    }

    it("opens on a left-edge swipe and cancels the browser's back gesture", () => {
      const onOpen = vi.fn();
      render(
        <MobileDrawer collapsed onClose={vi.fn()} onOpen={onOpen} closeLabel="Close menu">
          <div>drawer body</div>
        </MobileDrawer>,
      );

      const backGestureCancelled = swipe(edgeStrip(), [
        [4, 400],
        [40, 402],
        [80, 404],
      ]);

      expect(onOpen).toHaveBeenCalledTimes(1);
      expect(backGestureCancelled).toBe(true);
    });

    it("closes on a swipe left across the panel", () => {
      const onClose = vi.fn();
      render(
        <MobileDrawer collapsed={false} onClose={onClose} onOpen={vi.fn()} closeLabel="Close menu">
          <div data-testid="body">drawer body</div>
        </MobileDrawer>,
      );

      swipe(panel(), [
        [280, 400],
        [200, 402],
        [140, 404],
      ]);

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("ignores a vertical scroll that drifts sideways", () => {
      const onClose = vi.fn();
      render(
        <MobileDrawer collapsed={false} onClose={onClose} onOpen={vi.fn()} closeLabel="Close menu">
          <div data-testid="body">drawer body</div>
        </MobileDrawer>,
      );

      // dx clears the swipe threshold, but dy marks it as a scroll.
      swipe(panel(), [
        [280, 500],
        [240, 420],
        [200, 300],
      ]);

      expect(onClose).not.toHaveBeenCalled();
    });

    it("leaves the screen edge alone when no onOpen is given", () => {
      render(
        <MobileDrawer collapsed onClose={vi.fn()} closeLabel="Close file tree">
          <div>drawer body</div>
        </MobileDrawer>,
      );

      expect(edgeStrip()).toBeNull();
    });
  });
});
