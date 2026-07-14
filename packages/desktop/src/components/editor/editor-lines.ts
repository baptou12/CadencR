import { EditorView } from "@codemirror/view";

export function clampEditorLineNumber(lineNumber: number, lineCount: number): number {
  return Math.min(Math.max(1, lineNumber), Math.max(1, lineCount));
}

export function scrollToEditorLine(view: EditorView, lineNumber: number): void {
  const target = clampEditorLineNumber(lineNumber, view.state.doc.lines);
  const line = view.state.doc.line(target);
  view.dispatch({
    selection: { anchor: line.from },
    effects: EditorView.scrollIntoView(line.from, { y: "center" }),
  });
}
