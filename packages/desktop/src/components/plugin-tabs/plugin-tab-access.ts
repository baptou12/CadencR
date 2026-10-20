import type { TabAccessLevel, TabBackend } from "@/api/generated";

/**
 * The three custom tab levels (docs/CUSTOM_TABS.md §6), in the user's words.
 * One source for every place that names them — the settings card, the
 * consent dialog, the tab trigger, the "+" menu and the Activity dialog — so
 * a level is never described two ways.
 */
export interface AccessLevelCopy {
  /** Badge text. */
  label: string;
  /** One sentence: what the level lets the tab do. */
  summary: string;
}

export const ACCESS_LEVEL_COPY: Record<TabAccessLevel, AccessLevelCopy> = {
  ui: {
    label: "Read-only",
    summary: "Shows a page that reads Cadencr data only through its permissions.",
  },
  commands: {
    label: "Runs commands",
    summary:
      "Asks Cadencr to run the programs it lists on your computer, in this conversation's folder.",
  },
  backend: {
    label: "Native code",
    summary:
      "Runs its own program on your computer with your user rights. Cadencr does not sandbox it.",
  },
};

// Literal class strings: Tailwind only emits arbitrary values it finds verbatim.
// Read-only informs (muted); commands need attention (amber, the needs-action
// level); native code is the riskiest (red).
export const ACCESS_LEVEL_TONE: Record<TabAccessLevel, string> = {
  ui: "bg-muted text-muted-foreground",
  commands: "bg-[color-mix(in_oklab,var(--acc-yellow)_16%,transparent)] text-[var(--acc-yellow)]",
  backend: "bg-[color-mix(in_oklab,var(--acc-red)_14%,transparent)] text-[var(--acc-red)]",
};

/** `node backend/server.mjs`: the backend launch line as the user would type it. */
export function backendCommandLine(backend: TabBackend): string {
  return [backend.command, ...(backend.args ?? [])].join(" ");
}
