/**
 * Single mount point for the editor's LSP UI layer: the symbol breadcrumbs
 * bar (rendered above the buffer) and the navigation/refactor commands +
 * dialogs (find-references, rename, symbol pickers).
 *
 * Extracted from `CodeMirrorEditor` so that file stays under the size cap. The
 * layer owns its own document-version counter (tracked via a CodeMirror update
 * listener) so the breadcrumbs re-fetch symbols after edits without
 * `CodeMirrorEditor` having to thread state through.
 *
 * Two render slots: the breadcrumbs go in the editor header (above the
 * buffer), the commands are headless overlays. We expose them as separate
 * components so the parent can place the breadcrumbs where it wants while the
 * commands sit alongside the other editor overlays.
 */
import { useEffect, useState } from "react";
import type { EditorView } from "@codemirror/view";
import EditorBreadcrumbs from "./EditorBreadcrumbs";
import { EditorLspCommands } from "./EditorLspCommands";

interface BreadcrumbsSlotProps {
  view: EditorView;
  /** True when the LSP type checker is ready (document symbols available). */
  ready: boolean;
}

/** Breadcrumbs bar; tracks its own doc-version off a CodeMirror listener. */
export function EditorBreadcrumbsSlot({ view, ready }: BreadcrumbsSlotProps) {
  const [docVersion, setDocVersion] = useState(0);
  useEffect(() => {
    // CodeMirror's own DOM "input" event fires on document edits; cheaper than
    // wiring an updateListener compartment just for a counter.
    const dom = view.contentDOM;
    const bump = (): void => setDocVersion((v) => v + 1);
    dom.addEventListener("input", bump);
    return () => dom.removeEventListener("input", bump);
  }, [view]);
  return <EditorBreadcrumbs view={view} enabled={ready} docVersion={docVersion} />;
}

interface CommandsSlotProps {
  view: EditorView;
  projectId: number;
  featureId: number;
  workspaceRoot: string | null;
}

/** Headless LSP commands + their dialogs/overlays. */
export function EditorCommandsSlot({
  view,
  projectId,
  featureId,
  workspaceRoot,
}: CommandsSlotProps) {
  return (
    <EditorLspCommands
      view={view}
      projectId={projectId}
      featureId={featureId}
      workspaceRoot={workspaceRoot}
      enabled
    />
  );
}
