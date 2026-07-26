import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { THEME_LIST, type ThemeDefinition, type ThemeId } from "@/lib/themes";

/**
 * Full-width horizontal carousel of theme cards. Cards lay out in a single
 * scrollable row; chevron buttons scroll by a viewport, and the radiogroup
 * handles ArrowLeft / ArrowRight for keyboard navigation (which also live-
 * applies the theme so the user sees the change behind the drawer).
 */
interface ThemePickerProps {
  title: string;
  selectedThemeId: ThemeId;
  onSelect: (id: ThemeId) => void;
  disabled: boolean;
  /** If true, the currently selected card is focused on mount. */
  autoFocus?: boolean;
}

function useSelectedThemeFocus(
  scrollerRef: RefObject<HTMLDivElement | null>,
  selectedIndex: number,
  autoFocus: boolean,
): void {
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const target = scroller.querySelector<HTMLElement>(
      `[data-theme-card="${THEME_LIST[selectedIndex]?.id}"]`,
    );
    target?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [scrollerRef, selectedIndex]);

  useEffect(() => {
    if (!autoFocus) return;
    const target = scrollerRef.current?.querySelector<HTMLElement>(
      `[data-theme-card="${THEME_LIST[selectedIndex]?.id}"]`,
    );
    target?.focus({ preventScroll: true });
    // The selected card should only autofocus when the picker mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export function ThemePicker({
  title,
  selectedThemeId,
  onSelect,
  disabled,
  autoFocus = false,
}: ThemePickerProps): React.JSX.Element {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const selectedIndex = useMemo(
    () =>
      Math.max(
        0,
        THEME_LIST.findIndex((t) => t.id === selectedThemeId),
      ),
    [selectedThemeId],
  );

  useSelectedThemeFocus(scrollerRef, selectedIndex, autoFocus);

  const step = useCallback(
    (direction: 1 | -1): void => {
      if (disabled) return;
      const nextIndex = (selectedIndex + direction + THEME_LIST.length) % THEME_LIST.length;
      const next = THEME_LIST[nextIndex];
      if (!next) return;
      onSelect(next.id);
      // Move focus to the new card so subsequent arrows continue to work.
      requestAnimationFrame(() => {
        const card = scrollerRef.current?.querySelector<HTMLElement>(
          `[data-theme-card="${next.id}"]`,
        );
        card?.focus({ preventScroll: true });
      });
    },
    [disabled, onSelect, selectedIndex],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>): void => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      step(e.key === "ArrowRight" ? 1 : -1);
    },
    [step],
  );

  return (
    <section className="space-y-2" aria-label={title}>
      <h3 className="text-sm font-medium">{title}</h3>
      <div className="relative">
        <Button
          type="button"
          variant="outline"
          size="icon-xs"
          aria-label={`Previous ${title}`}
          disabled={disabled}
          onClick={() => step(-1)}
          className="absolute left-0 top-1/2 z-10 -translate-y-1/2 shadow-md"
        >
          <ChevronLeft />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon-xs"
          aria-label={`Next ${title}`}
          disabled={disabled}
          onClick={() => step(1)}
          className="absolute right-0 top-1/2 z-10 -translate-y-1/2 shadow-md"
        >
          <ChevronRight />
        </Button>
        <div
          ref={scrollerRef}
          role="radiogroup"
          aria-label={title}
          onKeyDown={handleKeyDown}
          className={cn(
            "flex w-full flex-nowrap gap-2 overflow-x-auto scroll-smooth px-8 py-1",
            "[scrollbar-width:thin]",
          )}
        >
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
      data-theme-card={theme.id}
      tabIndex={selected ? 0 : -1}
      disabled={disabled}
      onClick={() => onSelect(theme.id)}
      className={cn(
        "flex w-24 shrink-0 snap-start flex-col items-start gap-1.5 rounded-md border p-1.5 text-left transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:cursor-not-allowed disabled:opacity-50",
        selected
          ? "border-primary/60 bg-primary/8"
          : "border-border bg-background hover:bg-muted/40",
      )}
    >
      <ThemeSwatch theme={theme} />
      <div className="min-w-0">
        <div className="truncate text-[11px] font-medium leading-tight">{theme.label}</div>
        <div className="text-[10px] text-muted-foreground capitalize leading-tight">
          {theme.appearance}
        </div>
      </div>
    </button>
  );
}

/** Compact swatch: top half background (with sample text in foreground),
 *  bottom half a primary/accent split. */
function ThemeSwatch({ theme }: { theme: ThemeDefinition }): React.JSX.Element {
  const { background, foreground, primary, accent } = theme.swatch;
  return (
    <div
      className="flex h-9 w-full flex-col overflow-hidden rounded border border-border"
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
