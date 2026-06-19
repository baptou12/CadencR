/**
 * Cadencr go-to-definition.
 *
 * Wraps `textDocument/definition` directly instead of using
 * `jumpToDefinition` from `@codemirror/lsp-client`. The library version
 * surfaces failures via `plugin.reportError`, which paints a red banner
 * at the top of the editor buffer — that's loud and persists until the
 * user dismisses it. Cadencr surfaces transient errors as toasts so the
 * editor chrome stays clean, and that requires owning the error path.
 *
 * The capability check and `withMapping` ceremony mirror the library so
 * the only behavioral difference is *where* failures are displayed.
 */
import { type EditorView, type Command, type KeyBinding } from "@codemirror/view";
import { LSPPlugin } from "@codemirror/lsp-client";
import { toast } from "sonner";

// Subset of LSP 3.17 we actually use. Inlined rather than pulling in
// `vscode-languageserver-protocol` as a direct dep — the only
// runtime carrier of these types is the JSON-RPC wire.
interface LspPosition {
  line: number;
  character: number;
}
interface LspLocation {
  uri: string;
  range: { start: LspPosition; end: LspPosition };
}
interface DefinitionParams {
  textDocument: { uri: string };
  position: LspPosition;
}
type DefinitionResponse = LspLocation | LspLocation[] | null;

/**
 * Run the jump. Returns `true` when the command was applicable (there was
 * an LSP plugin and the server advertised `definitionProvider`), so the
 * keymap can swallow the event. Errors surface as a single toast.
 */
function runJumpToDefinition(view: EditorView): boolean {
  // With multiple clients mounted (type checker + linters), `LSPPlugin.get`
  // returns the FIRST mounted lspPlugin. `useLsp` mounts the type checker's
  // plugin first precisely so navigation targets it, not a linter.
  const plugin = LSPPlugin.get(view);
  if (!plugin) return false;
  // `serverCapabilities` is null until the server's `initialize` response
  // lands. Treat that and an absent provider the same — caller is welcome
  // to retry once the server is ready.
  const provider = plugin.client.serverCapabilities?.definitionProvider;
  if (!provider) return false;

  plugin.client.sync();
  void plugin.client.withMapping(async (mapping) => {
    try {
      const response = await plugin.client.request<DefinitionParams, DefinitionResponse>(
        "textDocument/definition",
        {
          textDocument: { uri: plugin.uri },
          position: plugin.toPosition(view.state.selection.main.head),
        },
      );
      const loc = Array.isArray(response) ? response[0] : response;
      if (!loc) return;

      const target =
        loc.uri === plugin.uri ? view : await plugin.client.workspace.displayFile(loc.uri);
      if (!target) return;

      const pos = mapping.getMapping(loc.uri)
        ? mapping.mapPosition(loc.uri, loc.range.start)
        : plugin.fromPosition(loc.range.start, target.state.doc);
      target.dispatch({
        selection: { anchor: pos },
        scrollIntoView: true,
        userEvent: "select.definition",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Go to definition failed: ${msg}`);
    }
  });
  return true;
}

/** @public */
export const jumpToDefinitionCommand: Command = runJumpToDefinition;

/** F12 binding for the toast-wrapped jump. */
export const jumpToDefinitionKeymap: readonly KeyBinding[] = [
  { key: "F12", run: jumpToDefinitionCommand, preventDefault: true },
];
