import type { ThemeDefinition } from "@/lib/themes";

/**
 * Compact theme preview: top half the page background carrying sample text in
 * the foreground color, bottom half a primary/accent split. Shared by the theme
 * picker carousel and the theme library gallery so a theme looks the same
 * wherever it's offered.
 */
export function ThemeSwatch({ theme }: { theme: ThemeDefinition }): React.JSX.Element {
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
