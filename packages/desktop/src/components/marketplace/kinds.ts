import { Bot, Palette, type LucideIcon } from "lucide-react";
import { PLUGIN_KINDS, type PluginKind } from "@/lib/marketplace-listings";

interface KindMeta {
  label: string;
  plural: string;
  icon: LucideIcon;
  /** CSS class carrying the kind's tone (`--mp-kind`), see marketplace.css. */
  tone: string;
  /** One line on what installing this kind does to Cadencr. */
  pitch: string;
}

/** Display order is user-visible: the order kinds appear in filters and shelves. */
export const KIND_ORDER = PLUGIN_KINDS;

export const KINDS: Record<PluginKind, KindMeta> = {
  theme: {
    label: "Theme",
    plural: "Themes",
    icon: Palette,
    tone: "mp-kind-theme",
    pitch: "Recolor every surface of Cadencr. Declarative colors only — no code runs.",
  },
  provider: {
    label: "Provider",
    plural: "Providers",
    icon: Bot,
    tone: "mp-kind-provider",
    pitch: "Bring another coding agent into Cadencr over ACP. Runs a verified executable.",
  },
};
