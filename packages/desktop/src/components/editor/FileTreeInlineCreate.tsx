import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { File, Folder, Loader2 } from "lucide-react";
import { validateSimpleName } from "@/lib/validate-name";

interface FileTreeInlineCreateProps {
  kind: "file" | "folder";
  depth: number;
  pending: boolean;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}

/**
 * Inline file-tree row that asks for a new file/folder name. Used at the
 * root level (where the Popover anchor would have nowhere meaningful to
 * attach to) and as a clearer alternative to the popover for known parents.
 *
 * Keyboard contract:
 *   - Enter   submit
 *   - Escape  cancel (lets the parent reset the editing state)
 *   - blur    cancel (mirrors VS Code / Finder rename UX)
 */
export default function FileTreeInlineCreate({
  kind,
  depth,
  pending,
  onSubmit,
  onCancel,
}: FileTreeInlineCreateProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  // The blur handler races with Enter submit / Escape cancel; this flag
  // lets those handlers suppress the blur-driven cancel.
  const suppressBlur = useRef(false);
  // Becomes true once the input has actually held focus. Until then we
  // ignore blur events: Radix restores focus to the context-menu trigger
  // asynchronously after our mount, and any focus() we issue before that
  // restoration loses the race — the resulting blur would cancel the row
  // before the user can type a single character. (Most visible on the root
  // context menu where the trigger is the outer scrolling tree div.)
  const hasFocusedRef = useRef(false);

  useEffect(() => {
    // Retry focus until activeElement actually matches our input. This
    // outlasts Radix's async focus restoration without us having to know
    // its exact timing.
    let cancelled = false;
    function tryFocus() {
      if (cancelled) return;
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      if (document.activeElement === el) {
        hasFocusedRef.current = true;
        return;
      }
      requestAnimationFrame(tryFocus);
    }
    requestAnimationFrame(tryFocus);
    return () => {
      cancelled = true;
    };
  }, []);

  function submit(e?: FormEvent) {
    e?.preventDefault();
    const trimmed = value.trim();
    const err = validateSimpleName(trimmed);
    if (err) {
      setError(err);
      return;
    }
    suppressBlur.current = true;
    onSubmit(trimmed);
  }

  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      suppressBlur.current = true;
      onCancel();
    }
  }

  return (
    <form onSubmit={submit}>
      <div
        className="flex items-center gap-1 px-2 py-0.5 text-sm"
        style={{ paddingLeft: `${8 + depth * 12}px` }}
      >
        <span className="w-3 h-3 shrink-0" />
        {kind === "folder" ? (
          <Folder className="w-4 h-4 shrink-0 text-muted-foreground" />
        ) : (
          <File className="w-4 h-4 shrink-0 text-muted-foreground" />
        )}
        <input
          ref={inputRef}
          value={value}
          placeholder={kind === "folder" ? "folder" : "filename.txt"}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={handleKey}
          onBlur={() => {
            if (suppressBlur.current) return;
            // Ignore stray blurs that fire before the input has ever taken
            // focus — those come from Radix restoring focus to the trigger,
            // not from a deliberate user action.
            if (!hasFocusedRef.current) return;
            onCancel();
          }}
          disabled={pending}
          className="flex-1 min-w-0 bg-background border border-input rounded px-1 py-0 text-sm outline-none focus-visible:border-ring focus-visible:ring-ring/30 focus-visible:ring-2 disabled:opacity-50"
          aria-invalid={error != null}
        />
        {pending && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
      </div>
      {error && (
        <div
          className="text-[11px] text-destructive"
          style={{ paddingLeft: `${28 + depth * 12}px` }}
        >
          {error}
        </div>
      )}
    </form>
  );
}
