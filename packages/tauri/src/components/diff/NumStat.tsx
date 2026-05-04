/**
 * `+A`/`-D` numstat badge — single source of truth for the per-file and
 * aggregate diff counters that appear in:
 *
 *  • the commit dialog file list,
 *  • the diff viewer's aggregate header,
 *  • the per-file diff header,
 *  • the inline-diff block,
 *  • the project feature row's git-stats column,
 *  • the large-file / binary-file placeholder.
 *
 * Theme tokens `--editor-green` / `--editor-red` replace the Dracula
 * hex codes that several call sites had hardcoded — the visual is
 * near-identical and we no longer leak palette decisions across the
 * codebase. Use `hideZero={false}` for header slots that always reserve
 * both numbers; the default hides whichever side is zero so per-row
 * lists stay quiet for unchanged / untracked files.
 */
import { type ReactElement } from "react";
import { cn } from "@/lib/utils";

interface NumStatProps {
  additions: number | null | undefined;
  deletions: number | null | undefined;
  /**
   * Hide each side when its count is zero (default `true`). Pass `false`
   * for headers and other layouts that always render both slots.
   */
  hideZero?: boolean;
  /**
   * Optional visible separator rendered between the two values (e.g.
   * `" / "`). Omit to let the flex `gap` do the spacing.
   */
  separator?: string;
  className?: string;
}

export function NumStat({
  additions,
  deletions,
  hideZero = true,
  separator,
  className,
}: NumStatProps): ReactElement | null {
  const adds = additions ?? 0;
  const dels = deletions ?? 0;
  if (hideZero && adds === 0 && dels === 0) return null;
  const showAdds = !hideZero || adds > 0;
  const showDels = !hideZero || dels > 0;
  return (
    <span className={cn("inline-flex items-center gap-1.5 font-mono tabular-nums", className)}>
      {showAdds && <span className="text-[var(--editor-green)]">+{adds}</span>}
      {showAdds && showDels && separator != null && (
        <span className="text-muted-foreground">{separator}</span>
      )}
      {showDels && <span className="text-[var(--editor-red)]">-{dels}</span>}
    </span>
  );
}
