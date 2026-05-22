/**
 * CodeMirror extension that turns CMD-click (macOS) / CTRL-click (Linux,
 * Windows) on a symbol into `jumpToDefinition`. We key on the modifier state
 * (`metaKey || ctrlKey`) rather than the resulting character so AZERTY users
 * and remapped keyboards aren't accidentally locked out.
 *
 * The F12 binding from `jumpToDefinitionKeymap` (provided by
 * `languageServerSupport`) stays in place for keyboard users.
 */
import { EditorView } from "@codemirror/view";
import { jumpToDefinition } from "@codemirror/lsp-client";

/** @public */
export function lspModClickExtension(): ReturnType<typeof EditorView.domEventHandlers> {
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      // Only left-clicks with the modifier.
      if (event.button !== 0) return false;
      if (!(event.metaKey || event.ctrlKey)) return false;
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos == null) return false;
      // Move the cursor to the click target — `jumpToDefinition` reads the
      // selection head — then fire the command. We swallow the event so the
      // browser doesn't also start a text selection or open a context menu.
      view.dispatch({ selection: { anchor: pos }, userEvent: "select.pointer" });
      event.preventDefault();
      jumpToDefinition(view);
      return true;
    },
  });
}
