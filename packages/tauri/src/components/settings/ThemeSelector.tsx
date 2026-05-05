import { cn } from "@/lib/utils";
import { useTheme } from "@/hooks/useTheme";
import { THEME_LIST, type ThemeDefinition, type ThemeId } from "@/lib/themes";
import { Switch } from "@/components/ui/switch";

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
  const {
    manualThemeId,
    systemLightThemeId,
    systemDarkThemeId,
    followSystemTheme,
    setTheme,
    setFollowSystemTheme,
    setSystemLightTheme,
    setSystemDarkTheme,
    isLoading,
  } = useTheme();
  const followSystemId = "follow-system-theme";

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-background px-4 py-3">
        <span className="space-y-1">
          <label htmlFor={followSystemId} className="block text-sm font-medium">
            Follow system theme
          </label>
          <span className="block text-xs text-muted-foreground">
            Switch automatically when your OS changes between light and dark mode.
          </span>
        </span>
        <Switch
          id={followSystemId}
          checked={followSystemTheme}
          disabled={isLoading}
          onCheckedChange={setFollowSystemTheme}
        />
      </div>

      {followSystemTheme ? (
        <div className="space-y-5">
          <ThemePicker
            title="Light system theme"
            selectedThemeId={systemLightThemeId}
            onSelect={setSystemLightTheme}
            disabled={isLoading}
          />
          <ThemePicker
            title="Dark system theme"
            selectedThemeId={systemDarkThemeId}
            onSelect={setSystemDarkTheme}
            disabled={isLoading}
          />
        </div>
      ) : (
        <ThemePicker
          title="All UI theme"
          selectedThemeId={manualThemeId}
          onSelect={setTheme}
          disabled={isLoading}
        />
      )}
    </div>
  );
}

interface ThemePickerProps {
  title: string;
  selectedThemeId: ThemeId;
  onSelect: (id: ThemeId) => void;
  disabled: boolean;
}

function ThemePicker({
  title,
  selectedThemeId,
  onSelect,
  disabled,
}: ThemePickerProps): React.JSX.Element {
  return (
    <section className="space-y-2" aria-label={title}>
      <h3 className="text-sm font-medium">{title}</h3>
      <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label={title}>
        {THEME_LIST.map((theme) => (
          <ThemeCard
            key={theme.id}
            theme={theme}
            selected={theme.id === selectedThemeId}
            onSelect={onSelect}
            disabled={disabled}
          />
        ))}
      </div>
    </section>
  );
}

interface ThemeCardProps {
  theme: ThemeDefinition;
  selected: boolean;
  onSelect: (id: ThemeId) => void;
  disabled: boolean;
}

function ThemeCard({ theme, selected, onSelect, disabled }: ThemeCardProps): React.JSX.Element {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={() => onSelect(theme.id)}
      className={cn(
        "flex w-full items-center gap-4 rounded-lg border px-4 py-3 text-left transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-50",
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
