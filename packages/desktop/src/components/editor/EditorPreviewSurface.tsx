/**
 * Dispatch surface for the in-editor "Preview" toggle. Given the
 * current buffer content + the file's `PreviewKind`, renders the
 * matching preview (Markdown, HTML iframe, or inline SVG).
 *
 * Lazy-loaded by `CodeMirrorEditor` so the Markdown bundle only
 * downloads when a preview is actually opened. HTML and SVG previews
 * are tiny inline renderers, so they don't need their own lazy chunks.
 */
import { memo, useMemo } from "react";
import type { PreviewKind } from "@/lib/file-language";
import { Markdown } from "@/components/Markdown";
import { CheckerboardBackdrop } from "./CheckerboardBackdrop";

interface EditorPreviewSurfaceProps {
  kind: PreviewKind;
  content: string;
  /** Stable key used by the Markdown renderer's cache. */
  filePath: string;
}

export const EditorPreviewSurface = memo(function EditorPreviewSurface({
  kind,
  content,
  filePath,
}: EditorPreviewSurfaceProps) {
  // Memoize so React doesn't replace the SVG subtree on unrelated re-renders.
  const svgHtml = useMemo(() => ({ __html: content }), [content]);

  switch (kind) {
    case "markdown":
      return (
        <div className="flex-1 overflow-auto bg-background">
          <div className="max-w-3xl mx-auto px-6 py-4">
            <Markdown content={content} cacheKey={filePath} />
          </div>
        </div>
      );
    case "html":
      return (
        <div className="flex-1 overflow-hidden bg-background">
          {/* `allow-scripts` lets inline JS run, still isolates from same-origin. */}
          <iframe
            title="HTML preview"
            srcDoc={content}
            sandbox="allow-scripts"
            className="w-full h-full border-0 bg-background"
          />
        </div>
      );
    case "svg":
      return (
        <div className="flex-1 overflow-hidden">
          <CheckerboardBackdrop className="flex items-center justify-center p-6">
            <div
              className="max-w-full max-h-full [&>svg]:max-w-full [&>svg]:max-h-full [&>svg]:h-auto [&>svg]:w-auto"
              dangerouslySetInnerHTML={svgHtml}
            />
          </CheckerboardBackdrop>
        </div>
      );
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
});
