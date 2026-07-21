import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo } from "@codemirror/commands";
import { describe, expect, it } from "vitest";
import {
  applyConflictChoice,
  buildConflictHunks,
  mapConflictHunk,
} from "./conflict-resolution-adapter";

const result = "before\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> topic\nafter\n";

function viewFor(doc = result): EditorView {
  return new EditorView({ state: EditorState.create({ doc, extensions: [history()] }) });
}

describe("conflict resolution adapter", () => {
  it.each([
    ["current", "before\nours\nafter\n"],
    ["incoming", "before\ntheirs\nafter\n"],
    ["both", "before\nours\ntheirs\nafter\n"],
  ] as const)("applies %s as one undoable transaction", (choice, expected) => {
    const view = viewFor();
    const [hunk] = buildConflictHunks(result, "before\nours\nafter\n", "before\ntheirs\nafter\n");
    expect(applyConflictChoice(view, hunk, choice)).toBe(true);
    expect(view.state.doc.toString()).toBe(expected);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(result);
    view.destroy();
  });

  it("maps edits outside a hunk but disables overlapping and ambiguous edits", () => {
    const [hunk] = buildConflictHunks(result, "ours\n", "theirs\n");
    expect(mapConflictHunk(`prefix\n${result}`, hunk).from).toBe(14);
    expect(mapConflictHunk(result.replace("ours", "manual"), hunk).disabledReason).toMatch(
      /edited/,
    );
    expect(mapConflictHunk(`${result}${hunk.markerText}`, hunk).disabledReason).toMatch(
      /ambiguous/,
    );
  });

  it("reports an imprecise mapping so the resolver disables its actions", () => {
    // Sources that do not contain the marker sides verbatim can't be mapped
    // safely, so the hunk is flagged rather than offering a risky action.
    const [hunk] = buildConflictHunks(result, "unrelated\n", "different\n");
    expect(hunk.precise).toBe(false);
    expect(mapConflictHunk(result, hunk).disabledReason).toMatch(/precise/);
  });
});
