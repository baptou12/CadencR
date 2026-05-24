import { setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { LSPPlugin, type LSPClientExtension } from "@codemirror/lsp-client";
import { ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type * as lsp from "vscode-languageserver-protocol";

function toSeverity(severity: lsp.DiagnosticSeverity | undefined): Diagnostic["severity"] {
  switch (severity) {
    case 2:
      return "warning";
    case 3:
      return "info";
    case 4:
      return "hint";
    default:
      return "error";
  }
}

function clampOffset(offset: number, docLength: number): number {
  return Math.min(Math.max(offset, 0), docLength);
}

function toDiagnostic(plugin: LSPPlugin, item: lsp.Diagnostic): Diagnostic {
  const docLength = plugin.view.state.doc.length;
  const from = clampOffset(plugin.fromPosition(item.range.start), docLength);
  const to = clampOffset(plugin.fromPosition(item.range.end), docLength);
  return {
    from: Math.min(from, to),
    to: Math.max(from, to),
    severity: toSeverity(item.severity),
    source: item.source,
    message: item.message,
  };
}

const AUTO_SYNC_DELAY_MS = 500;

const autoSync = ViewPlugin.fromClass(
  class {
    private pending: ReturnType<typeof setTimeout> | null = null;

    update(update: ViewUpdate): void {
      if (!update.docChanged) return;
      if (this.pending) clearTimeout(this.pending);
      this.pending = setTimeout(() => {
        this.pending = null;
        const plugin = LSPPlugin.get(update.view);
        plugin?.client.sync();
      }, AUTO_SYNC_DELAY_MS);
    }

    destroy(): void {
      if (this.pending) clearTimeout(this.pending);
    }
  },
);

/**
 * CodeMirror's stock `serverDiagnostics()` advertises version support and then
 * drops every diagnostic whose version differs from its local workspace file
 * version. Several npm language servers publish diagnostics with versions that
 * do not line up with our lightweight editor workspace, which made all non-TS
 * diagnostics appear to be missing. We don't advertise version support and map
 * diagnostics onto the current document instead.
 */
export function cadencrServerDiagnostics(): LSPClientExtension {
  return {
    clientCapabilities: { textDocument: { publishDiagnostics: {} } },
    notificationHandlers: {
      "textDocument/publishDiagnostics": (client, params: lsp.PublishDiagnosticsParams) => {
        const file = client.workspace.getFile(params.uri);
        const view = file?.getView();
        const plugin = view ? LSPPlugin.get(view) : null;
        if (!view || !plugin) return false;
        const diagnostics = params.diagnostics.map((item) => toDiagnostic(plugin, item));
        view.dispatch(setDiagnostics(view.state, diagnostics));
        return true;
      },
    },
    editorExtension: autoSync,
  };
}
