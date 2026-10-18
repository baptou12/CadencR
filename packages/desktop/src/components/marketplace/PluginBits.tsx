import { format, formatDistanceToNowStrict } from "date-fns";
import { ArrowUpCircle, Check, CircleAlert, RotateCw } from "lucide-react";
import type { MarketplaceListing, PluginKind } from "@/lib/marketplace-listings";
import { Badge } from "@/components/ui/badge";
import { ProviderIconGraphic, useProviderMetadata } from "@/lib/provider-icons";
import { cn } from "@/lib/utils";
import { KINDS } from "./kinds";

/** "3 days ago"; the raw value when it does not parse, never a made-up date. */
export function formatAgo(iso?: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return Date.now() - date.getTime() < 60_000
    ? "just now"
    : formatDistanceToNowStrict(date, { addSuffix: true });
}

export function formatDay(iso?: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : format(date, "MMM d, yyyy");
}

/** Description with the one honest fallback, shared by every surface. */
export function describe(listing: MarketplaceListing): string {
  return listing.description || "No description in the catalog.";
}

export function byline(listing: MarketplaceListing): string {
  return listing.publisher ? `by ${listing.publisher}` : listing.id;
}

function KindChip({ kind }: { kind: PluginKind }): React.JSX.Element {
  const meta = KINDS[kind];
  const Icon = meta.icon;
  return (
    <span className={cn("mp-kind-chip", meta.tone)}>
      <Icon aria-hidden="true" className="size-3" />
      {meta.label}
    </span>
  );
}

export function KindChips({ kinds }: { kinds: PluginKind[] }): React.JSX.Element {
  return (
    <span className="flex flex-wrap items-center gap-1" aria-label="Adds">
      {kinds.map((kind) => (
        <KindChip key={kind} kind={kind} />
      ))}
    </span>
  );
}

function initials(name: string): string {
  const words = name.split(/[\s_-]+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2);
  return letters.toUpperCase();
}

/**
 * The plugin's identity mark: its own package icon once Cadencr has it (an
 * installed provider, resolved like every other provider icon), else a
 * monogram in the kind's tone. Catalog entries serve no icon before install.
 */
export function PluginMark({
  listing,
  size = 40,
}: {
  listing: MarketplaceListing;
  size?: number;
}): React.JSX.Element {
  const installedProvider = listing.kind === "provider" && !!listing.installed;
  const metadata = useProviderMetadata(installedProvider ? listing.id : null);
  return (
    <span
      aria-hidden="true"
      className={cn("mp-mark", KINDS[listing.kind].tone)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
    >
      {installedProvider && metadata?.iconSrc ? (
        <ProviderIconGraphic providerId={listing.id} metadata={metadata} alt="" className="" />
      ) : (
        initials(listing.name)
      )}
    </span>
  );
}

const STATE_TONES = {
  error: "bg-destructive/12 text-destructive",
  restart: "bg-[var(--acc-yellow)]/16 text-[var(--acc-yellow)]",
  primary: "bg-primary/12 text-primary",
  muted: "bg-foreground/7 text-muted-foreground",
} as const;

/** The one state that matters most for a listing, most actionable first. */
export function PluginStateBadge({
  listing,
  className,
}: {
  listing: MarketplaceListing;
  className?: string;
}): React.JSX.Element | null {
  const installed = listing.installed;
  const state = installed?.error
    ? {
        tone: STATE_TONES.error,
        icon: <CircleAlert aria-hidden="true" />,
        label: "Needs attention",
      }
    : installed?.restartRequired
      ? {
          tone: STATE_TONES.restart,
          icon: <RotateCw aria-hidden="true" />,
          label: "Restart to apply",
        }
      : listing.update
        ? {
            tone: STATE_TONES.primary,
            icon: <ArrowUpCircle aria-hidden="true" />,
            label: `Update ${listing.update}`,
          }
        : installed?.active
          ? {
              tone: STATE_TONES.primary,
              icon: <span className="size-1.5 rounded-full bg-primary" />,
              label: listing.kind === "theme" ? "In use" : "Active",
            }
          : installed
            ? { tone: STATE_TONES.muted, icon: <Check aria-hidden="true" />, label: "Installed" }
            : null;
  if (!state) return null;
  return (
    <Badge variant="ghost" className={cn("h-5 px-2 text-[11px]", state.tone, className)}>
      {state.icon}
      {state.label}
    </Badge>
  );
}
