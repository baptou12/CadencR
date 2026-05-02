import { cn } from "@/lib/utils";
import { useTheme } from "@/hooks/useTheme";
import { THEME_LIST, type ThemeDefinition, type ThemeId } from "@/lib/themes";

/**
 * Theme picker rendered as a radio-group of cards. Visually mirrors the
 * `LoaderStyleControl` pattern in `routes/settings.tsx` so the General tab
 * stays consistent.
 *
 * Each card shows a small swatch built from the theme's exported colors;
 * switching themes only flips `<html data-theme="…">` so no remount of
 * CodeMirror or xterm is needed.
 */
export function ThemeSelector(): React.JSX.Element {
  const { themeId, setTheme } = useTheme();
  return (
    <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Theme">
      {THEME_LIST.map((theme) => (
        <ThemeCard
          key={theme.id}
          theme={theme}
          selected={theme.id === themeId}
          onSelect={setTheme}
        />
      ))}
    </div>
  );
}

interface ThemeCardProps {
  theme: ThemeDefinition;
  selected: boolean;
  onSelect: (id: ThemeId) => void;
}

function ThemeCard({ theme, selected, onSelect }: ThemeCardProps): React.JSX.Element {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={() => onSelect(theme.id)}
      className={cn(
        "flex w-full items-center gap-4 rounded-lg border px-4 py-3 text-left transition-colors",
        selected
          ? "border-primary/60 bg-primary/8"
          : "border-border bg-background hover:bg-muted/40",
      )}
    >
      <ThemeSwatch theme={theme} />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="text-sm font-medium">{theme.label}</div>
        <div className="text-xs text-muted-foreground capitalize">{theme.appearance}</div>
      </div>
      <div
        className={cn(
          "size-3 shrink-0 rounded-full border transition-colors",
          selected ? "border-primary bg-primary" : "border-muted-foreground/40 bg-transparent",
        )}
      />
    </button>
  );
}

/** Swatch tile: half background (with sample text in foreground), half a
 *  primary/accent split. Mirrors the design HTML's preview style. */
function ThemeSwatch({ theme }: { theme: ThemeDefinition }): React.JSX.Element {
  const { background, foreground, primary, accent } = theme.swatch;
  return (
    <div
      className="flex size-10 shrink-0 flex-col overflow-hidden rounded-md border border-border"
      aria-hidden="true"
    >
      <div
        className="flex h-1/2 items-center justify-center"
        style={{ backgroundColor: background }}
      >
        <span className="text-[8px] font-bold" style={{ color: foreground }}>
          Aa
        </span>
      </div>
      <div className="flex h-1/2">
        <div className="flex-1" style={{ backgroundColor: primary }} />
        <div className="flex-1" style={{ backgroundColor: accent }} />
      </div>
    </div>
  );
}
