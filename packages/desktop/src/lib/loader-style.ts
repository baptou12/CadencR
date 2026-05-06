export const LOADER_STYLE_KEY = "loader_style";

export const LOADER_STYLE_OPTIONS = ["normal", "usage-glow"] as const;

export type LoaderStyle = (typeof LOADER_STYLE_OPTIONS)[number];

export interface LoaderStyleOption {
  value: LoaderStyle;
  label: string;
  description: string;
}

export interface ContextUsageAppearance {
  barClassName: string;
  glowColor: string;
}

export const DEFAULT_LOADER_STYLE: LoaderStyle = "normal";

export const LOADER_STYLE_DETAILS: readonly LoaderStyleOption[] = [
  {
    value: "normal",
    label: "Normal",
    description: "Keep the current square streaming indicator and standard context usage bar.",
  },
  {
    value: "usage-glow",
    label: "Usage Glow",
    description:
      "Hide the square and let the context usage bar carry a subtle neon pulse while the agent is running.",
  },
] as const;

export function parseLoaderStyle(value: string | null | undefined): LoaderStyle {
  if (value === "usage-glow") {
    return value;
  }

  return DEFAULT_LOADER_STYLE;
}

export function getContextUsageAppearance(ratio: number): ContextUsageAppearance {
  if (ratio > 0.9) {
    return { barClassName: "bg-[var(--acc-red)]", glowColor: "var(--acc-red)" };
  }

  if (ratio > 0.8) {
    return { barClassName: "bg-[var(--acc-orange)]", glowColor: "var(--acc-orange)" };
  }

  if (ratio > 0.5) {
    return { barClassName: "bg-[var(--acc-yellow)]", glowColor: "var(--acc-yellow)" };
  }

  return { barClassName: "bg-[var(--acc-green)]", glowColor: "var(--acc-green)" };
}
