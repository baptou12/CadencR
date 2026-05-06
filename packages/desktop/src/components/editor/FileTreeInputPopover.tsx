import { useEffect, useRef, useState, type ReactNode, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { validateSimpleName } from "@/lib/validate-name";

export type FileTreeInputMode = "rename" | "create-file" | "create-folder";

interface FileTreeInputPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: FileTreeInputMode;
  defaultValue?: string;
  pending: boolean;
  onSubmit: (value: string) => void;
  /**
   * The element the popover is anchored to (typically the file-tree row).
   * Wrapped in `PopoverAnchor asChild` so positioning follows the row.
   */
  children: ReactNode;
}

const LABELS: Record<FileTreeInputMode, { title: string; placeholder: string; submit: string }> = {
  rename: { title: "Rename", placeholder: "New name", submit: "Rename" },
  "create-file": { title: "New file", placeholder: "filename.txt", submit: "Create" },
  "create-folder": { title: "New folder", placeholder: "folder", submit: "Create" },
};

/**
 * Small inline popover used for rename, new-file, and new-folder UX in the
 * file tree. Anchored to the relevant row. Enter submits, Escape cancels via
 * Radix's built-in close behavior.
 *
 * Validates that the input is non-empty and contains no path separators or
 * traversal segments — the backend repeats the check, but failing fast in the
 * UI avoids a network round-trip.
 */
export default function FileTreeInputPopover({
  open,
  onOpenChange,
  mode,
  defaultValue = "",
  pending,
  onSubmit,
  children,
}: FileTreeInputPopoverProps) {
  const [value, setValue] = useState(defaultValue);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setValue(defaultValue);
      setError(null);
      // Defer focus until after the popover content mounts.
      const t = setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 0);
      return () => clearTimeout(t);
    }
  }, [open, defaultValue]);

  const labels = LABELS[mode];

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    const err = validateSimpleName(trimmed);
    if (err) {
      setError(err);
      return;
    }
    onSubmit(trimmed);
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>{children}</PopoverAnchor>
      <PopoverContent align="start" side="bottom" className="w-64 p-3">
        <form onSubmit={handleSubmit} className="flex flex-col gap-2">
          <label className="text-xs font-medium text-muted-foreground">{labels.title}</label>
          <Input
            ref={inputRef}
            value={value}
            placeholder={labels.placeholder}
            onChange={(e) => {
              setValue(e.target.value);
              if (error) setError(null);
            }}
            disabled={pending}
            aria-invalid={error != null}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={pending}>
              {pending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              {labels.submit}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
