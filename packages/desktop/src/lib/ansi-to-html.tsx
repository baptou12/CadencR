import Anser from "anser";
import React from "react";

// Dracula-inspired color palette mapped from anser's RGB output strings
// anser returns colors as "R, G, B" strings for standard ANSI codes
const COLOR_MAP: Record<string, string> = {
  // Standard foreground/background colors (anser's RGB values)
  "0, 0, 0": "#21222c", // black (30/40)
  "187, 0, 0": "#ff5555", // red (31/41)
  "0, 187, 0": "#50fa7b", // green (32/42)
  "187, 187, 0": "#f1fa8c", // yellow (33/43)
  "0, 0, 187": "#6272a4", // blue (34/44)
  "187, 0, 187": "#ff79c6", // magenta (35/45)
  "0, 187, 187": "#8be9fd", // cyan (36/46)
  "255,255,255": "#f8f8f2", // white (37/47) — note anser uses no spaces here
  "255, 255, 255": "#f8f8f2", // white variant
  // Bright colors (90-97 / 100-107)
  "85, 85, 85": "#6272a4", // bright black
  "255, 85, 85": "#ff6e6e", // bright red
  "0, 255, 0": "#69ff94", // bright green
  "255, 255, 85": "#ffffa5", // bright yellow
  "85, 85, 255": "#d6acff", // bright blue
  "255, 85, 255": "#ff92df", // bright magenta
  "85, 255, 255": "#a4ffff", // bright cyan
};

function resolveColor(rgb: string | null): string | undefined {
  if (!rgb) return undefined;
  return COLOR_MAP[rgb] ?? `rgb(${rgb})`;
}

interface AnserBundle {
  content: string;
  fg: string | null;
  bg: string | null;
  decoration: string | null;
  decorations?: string[];
  clearLine: boolean;
  was_processed: boolean;
}

function buildStyle(bundle: AnserBundle): React.CSSProperties {
  const style: React.CSSProperties = {};

  const fgColor = resolveColor(bundle.fg);
  if (fgColor) style.color = fgColor;

  const bgColor = resolveColor(bundle.bg);
  if (bgColor) style.backgroundColor = bgColor;

  const decs = bundle.decorations?.length
    ? bundle.decorations
    : bundle.decoration
      ? [bundle.decoration]
      : [];
  for (const dec of decs) {
    switch (dec) {
      case "bold":
        style.fontWeight = "bold";
        break;
      case "dim":
        style.opacity = 0.6;
        break;
      case "italic":
        style.fontStyle = "italic";
        break;
      case "underline":
        style.textDecoration = "underline";
        break;
      case "line-through":
      case "strikethrough":
        style.textDecoration = "line-through";
        break;
    }
  }

  return style;
}

/**
 * Parse ANSI escape sequences in text and return React nodes with styled spans.
 */
export function parseAnsi(text: string): React.ReactNode {
  if (!text) return text;

  // Use anser to parse ANSI codes into bundles
  const bundles = Anser.ansiToJson(text, {
    use_classes: false,
    json: true,
  }) as AnserBundle[];

  if (!bundles || bundles.length === 0) return text;

  // If no bundle has styling, return plain text
  const hasStyle = bundles.some(
    (b) =>
      b.was_processed &&
      (b.fg || b.bg || b.decoration || (b.decorations && b.decorations.length > 0)),
  );
  if (!hasStyle) {
    return bundles.map((b) => b.content).join("");
  }

  return bundles.map((bundle, i) => {
    if (!bundle.content) return null;
    const style = buildStyle(bundle);
    const hasAnyStyle = Object.keys(style).length > 0;
    if (!hasAnyStyle) {
      return bundle.content;
    }
    return (
      <span key={i} style={style}>
        {bundle.content}
      </span>
    );
  });
}
