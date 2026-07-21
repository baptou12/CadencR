import { getOriginalDoc } from "@codemirror/merge";
import type { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@/test-utils";
import ConflictUnifiedEditor from "./ConflictUnifiedEditor";

describe("ConflictUnifiedEditor", () => {
  it("uses the initial Result as the merge original in one writable view", async () => {
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      value: () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }),
    });
    const viewRef = { current: null as EditorView | null };
    const rendered = render(
      <ConflictUnifiedEditor
        initialContent="conflict result"
        currentLabel="Current branch"
        incomingLabel="Incoming branch"
        hunks={[]}
        language={null}
        vimMode={false}
        viewRef={viewRef}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onApply={vi.fn()}
        onEditorViewChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(viewRef.current).not.toBeNull());
    expect(rendered.container.querySelectorAll(".cm-editor")).toHaveLength(1);
    expect(getOriginalDoc(viewRef.current!.state).toString()).toBe("conflict result");
  });
});
