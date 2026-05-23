/**
 * CodeMirror extension that turns CMD-click (macOS) / CTRL-click (Linux,
 * Windows) on a symbol into go-to-definition. We key on the modifier state
 * (`metaKey || ctrlKey`) rather than the resulting character so AZERTY users
 * and remapped keyboards aren't accidentally locked out.
 *
 * Delegates to [`jumpToDefinitionCommand`] (our toast-wrapped wrapper) so
 * server errors surface as a sonner toast rather than the buffer-top banner
 * `@codemirror/lsp-client` paints by default.
 */
import { EditorView } from "@codemirror/view";
import { LSPPlugin } from "@codemirror/lsp-client";
import { toast } from "sonner";
import { jumpToDefinitionCommand } from "./definition";

// Tracks whether we've already nudged the user about the server still
// initializing — once per editor session is enough; spamming the toast
// stack while rust-analyzer indexes a large workspace would be noisy.
const startingHintShown = new WeakSet<EditorView>();

/** @public */
export function lspModClickExtension(): ReturnType<typeof EditorView.domEventHandlers> {
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      // Only left-clicks with the modifier.
      if (event.button !== 0) return false;
      if (!(event.metaKey || event.ctrlKey)) return false;
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos == null) return false;
      // Move the cursor to the click target — the command reads the
      // selection head — then fire. We swallow the event so the browser
      // doesn't also start a text selection or open a context menu.
      view.dispatch({ selection: { anchor: pos }, userEvent: "select.pointer" });
      event.preventDefault();
      if (jumpToDefinitionCommand(view)) return true;

      // Silent no-op = unsupported file (no LSP plugin) OR server not
      // ready. For unsupported files the status-bar indicator already
      // makes that obvious, but if the plugin is mounted the user just
      // tried to use a feature that the server hasn't initialized yet —
      // give them a one-shot toast so they know to wait, not retry.
      if (LSPPlugin.get(view) && !startingHintShown.has(view)) {
        startingHintShown.add(view);
        toast.info("Language server is still starting — try again in a moment.");
      }
      return true;
    },
  });
}
