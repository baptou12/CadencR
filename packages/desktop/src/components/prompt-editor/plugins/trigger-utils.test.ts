import { describe, it, expect } from "vitest";
import {
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $getRoot,
  $isElementNode,
  $setSelection,
  createEditor,
  type LexicalEditor,
} from "lexical";
import { $createSlashCommandNode, SlashCommandNode } from "../nodes/SlashCommandNode";
import { getEditorText } from "../editor-utils";
import { getTriggerMatch, replaceTriggerWithNode } from "./trigger-utils";

/** Minimal mock of a Lexical TextNode for getTriggerMatch */
function fakeTextNode(text: string) {
  return { getTextContent: () => text } as Parameters<typeof getTriggerMatch>[0];
}

describe("getTriggerMatch", () => {
  it("matches trigger at start of text", () => {
    const result = getTriggerMatch(fakeTextNode("@foo"), 4, "@");
    expect(result).toEqual({ query: "foo", triggerOffset: 0 });
  });

  it("matches trigger after whitespace", () => {
    const result = getTriggerMatch(fakeTextNode("hello @bar"), 10, "@");
    expect(result).toEqual({ query: "bar", triggerOffset: 6 });
  });

  it("returns null when trigger is mid-word", () => {
    const result = getTriggerMatch(fakeTextNode("test@bar"), 8, "@");
    expect(result).toBeNull();
  });

  it("returns null when no trigger present", () => {
    const result = getTriggerMatch(fakeTextNode("hello world"), 11, "@");
    expect(result).toBeNull();
  });

  it("returns null when query contains a space", () => {
    const result = getTriggerMatch(fakeTextNode("@foo bar"), 8, "@");
    expect(result).toBeNull();
  });

  it("only considers text up to anchorOffset", () => {
    const result = getTriggerMatch(fakeTextNode("@foo @bar"), 4, "@");
    expect(result).toEqual({ query: "foo", triggerOffset: 0 });
  });

  it("works with slash trigger", () => {
    const result = getTriggerMatch(fakeTextNode("/commit"), 7, "/");
    expect(result).toEqual({ query: "commit", triggerOffset: 0 });
  });

  it("returns empty query when only trigger char typed", () => {
    const result = getTriggerMatch(fakeTextNode("@"), 1, "@");
    expect(result).toEqual({ query: "", triggerOffset: 0 });
  });

  it("supports multi-character triggers", () => {
    expect(getTriggerMatch(fakeTextNode("compare @@auth"), 14, "@@")).toEqual({
      query: "auth",
      triggerOffset: 8,
    });
    expect(getTriggerMatch(fakeTextNode("@@"), 2, "@@")).toEqual({
      query: "",
      triggerOffset: 0,
    });
  });
});

/** Headless editor holding one paragraph per line, like the prompt editor. */
function editorWithLines(lines: string[]): LexicalEditor {
  const editor = createEditor({
    nodes: [SlashCommandNode],
    onError: (error) => {
      throw error;
    },
  });
  editor.update(
    () => {
      const root = $getRoot();
      root.clear();
      for (const line of lines) {
        const paragraph = $createParagraphNode();
        paragraph.append($createTextNode(line));
        root.append(paragraph);
      }
    },
    { discrete: true },
  );
  return editor;
}

function placeCursor(editor: LexicalEditor, lineIndex: number, offset: number): void {
  editor.update(
    () => {
      const paragraph = $getRoot().getChildAtIndex(lineIndex);
      const textNode = $isElementNode(paragraph) ? paragraph.getFirstChild() : null;
      if (!textNode) throw new Error("missing text node");
      const selection = $createRangeSelection();
      selection.anchor.set(textNode.getKey(), offset, "text");
      selection.focus.set(textNode.getKey(), offset, "text");
      $setSelection(selection);
    },
    { discrete: true },
  );
}

/** Serialize exactly the way the composer does when the prompt is sent. */
function readLines(editor: LexicalEditor): string {
  // A headless editor commits updates asynchronously; a discrete no-op update
  // flushes whatever `replaceTriggerWithNode` queued.
  editor.update(() => {}, { discrete: true });
  let text = "";
  editor.getEditorState().read(() => {
    text = getEditorText();
  });
  return text;
}

function commandChips(editor: LexicalEditor): string[] {
  let names: string[] = [];
  editor.getEditorState().read(() => {
    names = $getRoot()
      .getChildren()
      .flatMap((child) => ($isElementNode(child) ? child.getChildren() : []))
      .filter((node): node is SlashCommandNode => node instanceof SlashCommandNode)
      .map((node) => node.getCommandName());
  });
  return names;
}

describe("replaceTriggerWithNode", () => {
  it("replaces only the trigger, keeping text before and after the cursor", () => {
    const editor = editorWithLines(["check the diff, then /cadencr:sta and report back"]);
    placeCursor(editor, 0, "check the diff, then /cadencr:sta".length);

    replaceTriggerWithNode(
      editor,
      "/",
      (name) => $createSlashCommandNode(name, "/"),
      "cadencr:status",
      () => {},
    );

    // A space is inserted after the token node so the caret has a text position.
    expect(readLines(editor)).toBe("check the diff, then /cadencr:status  and report back");
    expect(commandChips(editor)).toEqual(["cadencr:status"]);
  });

  it("replaces a trigger on a later line without touching the other lines", () => {
    const editor = editorWithLines(["first line", "then $cadencr:sta at the end"]);
    placeCursor(editor, 1, "then $cadencr:sta".length);

    replaceTriggerWithNode(
      editor,
      "$",
      (name) => $createSlashCommandNode(name, "$"),
      "cadencr:status",
      () => {},
    );

    expect(readLines(editor)).toBe("first line\nthen $cadencr:status  at the end");
    expect(commandChips(editor)).toEqual(["cadencr:status"]);
  });

  it("replaces a trigger at the very end of a line", () => {
    const editor = editorWithLines(["please /cadencr:sta"]);
    placeCursor(editor, 0, "please /cadencr:sta".length);

    replaceTriggerWithNode(
      editor,
      "/",
      (name) => $createSlashCommandNode(name, "/"),
      "cadencr:status",
      () => {},
    );

    expect(readLines(editor)).toBe("please /cadencr:status ");
  });
});
