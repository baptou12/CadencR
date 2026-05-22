/**
 * `CadencrWorkspace` is the `@codemirror/lsp-client` `Workspace` impl that
 * bridges LSP-driven cross-file navigation (`jumpToDefinition`,
 * `findReferences`, …) into Cadencr's tab system.
 *
 * The default workspace shipped with `@codemirror/lsp-client` errors on
 * multi-view of the same file and has no way to *open* a file the user hasn't
 * opened yet — both required for go-to-definition. We mirror its
 * single-editor-per-URI tracking and override `displayFile(uri)` to delegate
 * tab-opening to a host-provided callback (typically `useEditorStore.openFile`
 * via the LSP client manager).
 */
import { Workspace, LSPPlugin, type WorkspaceFile, type LSPClient } from "@codemirror/lsp-client";
import type { ChangeSet, Text } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { fileUriToPath } from "./file-uri";

/** Mirrors the un-exported `WorkspaceFileUpdate` type from `@codemirror/lsp-client`. */
interface WorkspaceFileUpdate {
  file: WorkspaceFile;
  prevDoc: Text;
  changes: ChangeSet;
}

class CadencrWorkspaceFile implements WorkspaceFile {
  constructor(
    public uri: string,
    public languageId: string,
    public version: number,
    public doc: Text,
    public view: EditorView,
  ) {}

  getView(): EditorView | null {
    return this.view;
  }
}

/**
 * Host hook the workspace calls when LSP requests displaying a file the user
 * hasn't opened yet. Implementations should open the file in the appropriate
 * pane and resolve to its `EditorView` once mounted; resolve `null` if the
 * file can't be displayed (path outside workspace, etc.).
 *
 * @public
 */
export type DisplayFileHandler = (absPath: string) => Promise<EditorView | null>;

/** @public */
export class CadencrWorkspace extends Workspace {
  files: WorkspaceFile[] = [];
  private fileVersions: Record<string, number> = Object.create(null);
  private displayFileHandler: DisplayFileHandler | null = null;

  constructor(client: LSPClient) {
    super(client);
  }

  /** Set the host-provided file-opener used by `displayFile`. */
  setDisplayFileHandler(handler: DisplayFileHandler | null): void {
    this.displayFileHandler = handler;
  }

  private nextFileVersion(uri: string): number {
    const next = (this.fileVersions[uri] ?? -1) + 1;
    this.fileVersions[uri] = next;
    return next;
  }

  syncFiles(): readonly WorkspaceFileUpdate[] {
    const result: WorkspaceFileUpdate[] = [];
    for (const file of this.files as CadencrWorkspaceFile[]) {
      const plugin = LSPPlugin.get(file.view);
      if (!plugin) continue;
      const changes = plugin.unsyncedChanges;
      if (changes.empty) continue;
      result.push({ changes, file, prevDoc: file.doc });
      file.doc = file.view.state.doc;
      file.version = this.nextFileVersion(file.uri);
      plugin.clear();
    }
    return result;
  }

  openFile(uri: string, languageId: string, view: EditorView): void {
    // Single-view-per-URI: if another pane already shows this file, ignore the
    // second LSP plugin mount rather than throw. The first view drives sync;
    // the second still gets syntax highlighting + plain editing.
    if (this.getFile(uri)) return;
    const file = new CadencrWorkspaceFile(
      uri,
      languageId,
      this.nextFileVersion(uri),
      view.state.doc,
      view,
    );
    this.files.push(file);
    this.client.didOpen(file);
  }

  closeFile(uri: string, view: EditorView): void {
    const file = this.files.find((f) => f.uri === uri) as CadencrWorkspaceFile | undefined;
    if (!file || file.view !== view) return;
    this.files = this.files.filter((f) => f !== file);
    this.client.didClose(uri);
  }

  async displayFile(uri: string): Promise<EditorView | null> {
    const existing = this.getFile(uri);
    if (existing) return existing.getView();
    const absPath = fileUriToPath(uri);
    if (!absPath) return null;
    if (!this.displayFileHandler) return null;
    return await this.displayFileHandler(absPath);
  }
}
