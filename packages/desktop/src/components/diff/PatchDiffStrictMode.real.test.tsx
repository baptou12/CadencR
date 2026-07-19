import React, { createRef, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@/test-utils";
import { DiffVirtualizer } from "./DiffVirtualizer";
import { PatchDiffView } from "./PatchDiffView";

const patch = `diff --git a/src/foo.ts b/src/foo.ts
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1 +1 @@
-old
+new
`;

class Boundary extends React.Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }
  render(): ReactNode {
    return this.state.hasError ? <div>caught</div> : this.props.children;
  }
}

describe("PatchDiffView StrictMode integration", () => {
  it("does not retain a stale virtualized placeholder when StrictMode reattaches the host", async () => {
    let intersectionCallback: IntersectionObserverCallback | null = null;
    class ControllableIntersectionObserver {
      readonly root = null;
      readonly rootMargin = "";
      readonly thresholds = [0];
      constructor(callback: IntersectionObserverCallback) {
        intersectionCallback = callback;
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
    }
    const originalIntersectionObserver = window.IntersectionObserver;
    window.IntersectionObserver =
      ControllableIntersectionObserver as unknown as typeof IntersectionObserver;
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function getBoundingClientRect(this: HTMLElement): DOMRect {
        const top = this.tagName === "DIFFS-CONTAINER" ? 5_000 : 0;
        return {
          top,
          bottom: top,
          left: 0,
          right: 0,
          width: 0,
          height: 0,
          x: 0,
          y: top,
          toJSON: () => ({}),
        };
      });
    const scrollRef = createRef<HTMLDivElement>();
    function Harness({ show }: { show: boolean }) {
      return (
        <React.StrictMode>
          <DiffVirtualizer scrollRef={scrollRef}>
            {show ? (
              <PatchDiffView
                patch={patch}
                mode="unified"
                themeAppearance="dark"
                themeId="dracula"
              />
            ) : null}
          </DiffVirtualizer>
        </React.StrictMode>
      );
    }
    const view = render(<Harness show={false} />);
    view.rerender(<Harness show />);

    const host = view.container.querySelector("diffs-container");
    try {
      await waitFor(() =>
        expect(host?.shadowRoot?.querySelectorAll("[data-placeholder]")).toHaveLength(1),
      );
      if (!host || !intersectionCallback) throw new Error("Virtualized diff was not observed");
      act(() => {
        intersectionCallback?.(
          [{ isIntersecting: true, target: host } as IntersectionObserverEntry],
          {} as IntersectionObserver,
        );
      });
      await waitFor(() => expect(host.shadowRoot?.querySelectorAll("[data-diff]")).toHaveLength(1));
      expect(host.shadowRoot?.querySelectorAll("[data-placeholder]")).toHaveLength(0);
    } finally {
      rectSpy.mockRestore();
      window.IntersectionObserver = originalIntersectionObserver;
    }
  });

  it("unmounts without Pierre callback-ref cleanup errors", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = render(
      <React.StrictMode>
        <PatchDiffView patch={patch} mode="unified" themeAppearance="dark" themeId="dracula" />
      </React.StrictMode>,
    );

    expect(() => unmount()).not.toThrow();
    expect(errorSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("A FileDiff instance should exist when unmounting"),
    );
    errorSpy.mockRestore();
  });

  it("rerenders without Pierre callback-ref cleanup errors", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { rerender } = render(
      <React.StrictMode>
        <PatchDiffView patch={patch} mode="unified" themeAppearance="dark" themeId="dracula" />
      </React.StrictMode>,
    );

    expect(() =>
      rerender(
        <React.StrictMode>
          <PatchDiffView
            patch={patch.replace("+new", "+newer")}
            mode="unified"
            themeAppearance="dark"
            themeId="dracula"
          />
        </React.StrictMode>,
      ),
    ).not.toThrow();
    errorSpy.mockRestore();
  });

  it("does not mask invalid patch input with Pierre ref cleanup errors", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <Boundary>
        <PatchDiffView
          patch="not a patch"
          mode="unified"
          themeAppearance="dark"
          themeId="dracula"
        />
      </Boundary>,
    );

    expect(errorSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("A FileDiff instance should exist when unmounting"),
    );
    errorSpy.mockRestore();
  });
  it("survives rapid mount toggles", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    function Harness({ show }: { show: boolean }) {
      return (
        <React.StrictMode>
          {show ? (
            <PatchDiffView patch={patch} mode="unified" themeAppearance="dark" themeId="dracula" />
          ) : null}
        </React.StrictMode>
      );
    }
    const { rerender } = render(<Harness show />);

    expect(() => {
      rerender(<Harness show={false} />);
      rerender(<Harness show />);
      rerender(<Harness show={false} />);
    }).not.toThrow();
    errorSpy.mockRestore();
  });
});
