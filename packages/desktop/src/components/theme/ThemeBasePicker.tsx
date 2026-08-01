import type { ReactElement } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { THEME_LIST, type ThemeDefinition } from "@/lib/themes";
import { ThemeSwatch } from "./ThemeSwatch";

/**
 * Which theme to start from.
 *
 * A theme is 100-odd tokens that have to agree with each other, so there is no
 * "blank" option: every new theme is a copy of one that already renders. The
 * user's own themes are offered alongside the built-ins — iterating on your own
 * work is at least as common as starting from a shipped palette.
 */
export function ThemeBasePicker({
  userThemes,
  isCreating,
  onPick,
  onClose,
}: {
  userThemes: ThemeDefinition[];
  isCreating: boolean;
  onPick: (base: ThemeDefinition) => void;
  onClose: () => void;
}): ReactElement {
  const themes = [...THEME_LIST, ...userThemes];
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[80vh] gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle className="text-base font-semibold">Create theme</DialogTitle>
          <DialogDescription>
            Pick the theme to start from. You get a complete copy of its colors to edit — the
            original is untouched.
          </DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[60vh] grid-cols-2 gap-2 overflow-y-auto p-4 sm:grid-cols-4">
          {themes.map((theme) => (
            <button
              key={theme.id}
              type="button"
              disabled={isCreating}
              onClick={() => onPick(theme)}
              className={cn(
                "flex flex-col items-start gap-1.5 rounded-md border border-border bg-background p-2 text-left transition-colors",
                "hover:border-primary/50 hover:bg-muted/40",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                "disabled:cursor-not-allowed disabled:opacity-50",
              )}
            >
              <ThemeSwatch theme={theme} />
              <div className="min-w-0 w-full">
                <div className="truncate text-xs font-medium leading-tight">{theme.label}</div>
                <div className="text-[10px] capitalize leading-tight text-muted-foreground">
                  {theme.appearance}
                </div>
              </div>
            </button>
          ))}
        </div>
        {isCreating ? (
          <div className="flex items-center gap-2 border-t border-border px-6 py-3 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            Creating your copy…
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
