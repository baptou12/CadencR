import React, { type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "@/test-utils";
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
