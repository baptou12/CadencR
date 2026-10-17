import { z } from "zod";
import { MARKETPLACE_ENABLED } from "@/lib/marketplace-gate";

const settingsSearchSchema = z.object({
  section: z.string().optional().catch(undefined),
  /** Legacy: the marketplace used to be a Settings tab (`?tab=marketplace`). */
  tab: z.string().optional().catch(undefined),
});

export type SettingsSearch = z.infer<typeof settingsSearchSchema>;

export function parseSettingsSearch(search: Record<string, unknown>): SettingsSearch {
  return settingsSearchSchema.parse(search);
}

/** Old marketplace deep links into Settings now open the Marketplace page. */
export function isLegacyMarketplaceLink(search: SettingsSearch): boolean {
  return MARKETPLACE_ENABLED && (search.tab === "marketplace" || search.section === "marketplace");
}
