import type { QueryClient } from "@tanstack/react-query";
import { getListThemesQueryKey } from "@/api/generated";
import { createLeadingSettleCoalescer } from "./coalesceInvalidation";

/**
 * Refetch the user's themes.
 *
 * The window is short because this drives a live preview: the leading edge
 * fires immediately so a save repaints at once, and the trailing edge catches
 * the final content of a burst. Each refetch costs a full server-side re-read
 * and re-validation of every theme file, so an editor that saves on every
 * keystroke must not translate into one of those per keystroke.
 */
const THEME_INVALIDATION_SETTLE_MS = 150;

export function invalidateThemes(client: QueryClient): Promise<void> {
  return client.invalidateQueries({ queryKey: getListThemesQueryKey() });
}

const themeCoalescer = createLeadingSettleCoalescer<QueryClient>(
  invalidateThemes,
  THEME_INVALIDATION_SETTLE_MS,
);

export function scheduleThemeInvalidation(client: QueryClient): void {
  themeCoalescer.trigger(client);
}
