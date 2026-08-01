import { useRef, type ReactElement } from "react";
import { json } from "@codemirror/lang-json";
import { AlertTriangle } from "lucide-react";
import BaseCodeMirrorEditor from "@/components/editor/BaseCodeMirrorEditor";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ThemeStudioState } from "./useThemeStudio";

/**
 * The JSON half of the studio. Lazy so CodeMirror stays out of the settings
 * route until a theme is actually opened.
 *
 * The editor is uncontrolled — it owns its buffer and reports changes upward —
 * so replacing the text when the agent writes the file has to remount it, which
 * is what `editorKey` is for.
 */
export default function ThemeStudioEditor({ studio }: { studio: ThemeStudioState }): ReactElement {
  const jsonLanguage = useRef(json());

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-hidden">
        <BaseCodeMirrorEditor
          key={studio.editorKey}
          initialContent={studio.content}
          language={jsonLanguage.current}
          onChange={studio.setContent}
          onSave={studio.save}
          className="h-full overflow-auto text-sm"
        />
      </div>
      {studio.conflict ? (
        <StudioNotice tone="warning">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>The agent changed this file while you had unsaved edits.</span>
            <Button
              variant="ghost"
              size="xs"
              className="h-5 px-1.5 underline"
              onClick={studio.adoptFromDisk}
            >
              Load their version
            </Button>
          </div>
        </StudioNotice>
      ) : null}
      {studio.previewError ? (
        <StudioNotice tone="error">Not previewing: {studio.previewError}</StudioNotice>
      ) : null}
    </div>
  );
}

// Written out per tone rather than interpolated: Tailwind only emits an
// arbitrary-value utility it can find as a literal string in the source.
const NOTICE_TONE = {
  error: "bg-[color-mix(in_oklab,var(--acc-red)_8%,var(--card))] text-[var(--acc-red)]",
  warning: "bg-[color-mix(in_oklab,var(--acc-orange)_8%,var(--card))] text-[var(--acc-orange)]",
} as const;

/** An inline, non-blocking explanation under the editor. */
function StudioNotice({
  tone,
  children,
}: {
  tone: keyof typeof NOTICE_TONE;
  children: React.ReactNode;
}): ReactElement {
  return (
    <div
      className={cn(
        "flex items-start gap-1.5 border-t border-border px-4 py-2 text-xs",
        NOTICE_TONE[tone],
      )}
    >
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
