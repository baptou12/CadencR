import { useRef, useState } from "react";
import { json } from "@codemirror/lang-json";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import BaseCodeMirrorEditor from "@/components/editor/BaseCodeMirrorEditor";
import { SettingsJsonDialogShell } from "./SettingsJsonDialogShell";
import type { SettingWarning } from "@/api/generated";
import { apiErrorMessage } from "@/lib/api-errors";

interface SettingsJsonEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  path?: string;
  /** Current document text, seeded into the editor on open. */
  initialContent: string;
  isSaving: boolean;
  /** Persist `content`; resolves with non-blocking warnings, throws on error. */
  onSave: (content: string) => Promise<SettingWarning[]>;
  /** Invalidate the relevant settings queries after a successful save. */
  onSaved: () => void;
}

/**
 * Standalone JSON editor (our CodeMirror, no file tree) for a settings file.
 * Lazy-loaded so CodeMirror isn't pulled into the settings route until used.
 */
export default function SettingsJsonEditorDialog({
  open,
  onOpenChange,
  title,
  path,
  initialContent,
  isSaving,
  onSave,
  onSaved,
}: SettingsJsonEditorDialogProps): React.JSX.Element {
  // The editor owns its buffer; `initialContent` only seeds it on mount (this
  // component is mounted fresh each time the dialog opens).
  const contentRef = useRef(initialContent);
  const [error, setError] = useState<string | null>(null);
  const jsonLanguage = useRef(json());

  async function handleSave(): Promise<void> {
    setError(null);
    try {
      const warnings = await onSave(contentRef.current);
      onSaved();
      onOpenChange(false);
      if (warnings.length > 0) {
        toast.warning(
          warnings.length === 1
            ? "Settings saved with 1 warning"
            : `Settings saved with ${warnings.length} warnings`,
        );
      } else {
        toast.success("Settings saved");
      }
    } catch (e) {
      const message = apiErrorMessage(e, "Failed to save settings");
      setError(message);
      toast.error(message);
    }
  }

  return (
    <SettingsJsonDialogShell open={open} onOpenChange={onOpenChange} title={title} path={path}>
      <div className="min-h-0 flex-1 overflow-hidden border-b border-border">
        <BaseCodeMirrorEditor
          initialContent={initialContent}
          language={jsonLanguage.current}
          onChange={(value) => {
            contentRef.current = value;
          }}
          onSave={() => void handleSave()}
          className="h-full overflow-auto text-sm"
        />
      </div>

      {error ? (
        <div className="flex items-start gap-1.5 border-b border-border bg-[color-mix(in_oklab,var(--acc-red)_8%,var(--card))] px-6 py-2 text-xs text-[var(--acc-red)]">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      ) : null}

      <DialogFooter className="px-6 py-3">
        <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button size="sm" disabled={isSaving} onClick={() => void handleSave()}>
          {isSaving ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </SettingsJsonDialogShell>
  );
}
