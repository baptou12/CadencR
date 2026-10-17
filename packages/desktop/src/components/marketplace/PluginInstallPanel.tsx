import { Check, Loader2, Power } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { compareVersions, type MarketplaceListing } from "@/lib/marketplace-listings";
import { useMarketplaceState } from "./MarketplaceContext";
import { usePluginActions } from "./usePluginActions";

type PrimaryAction =
  | { state: "installed" | "choose" }
  | { state: "install" | "update" | "change"; version: string };

const LABELS = { install: "Install", update: "Update to", change: "Change to" } as const;

/** What the primary button offers for the chosen exact version. */
function primaryAction(listing: MarketplaceListing, version: string): PrimaryAction {
  const installed = listing.installed?.version;
  if (installed && version === installed) return { state: "installed" };
  if (!listing.versions.some((entry) => entry.version === version)) return { state: "choose" };
  if (!installed) return { state: "install", version };
  const newer = (compareVersions(version, installed) ?? 0) > 0;
  return { state: newer ? "update" : "change", version };
}

export function PluginInstallPanel({
  listing,
  version,
  onVersionChange,
}: {
  listing: MarketplaceListing;
  version: string;
  onVersionChange: (version: string) => void;
}): React.JSX.Element {
  const actions = usePluginActions();
  const action = primaryAction(listing, version);
  const offer = "version" in action ? action : null;
  const pending = actions.pending(listing);
  const installedVersion = listing.installed?.version;
  const orphan =
    !!installedVersion && !listing.versions.some((v) => v.version === installedVersion);
  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        {offer ? (
          <Button
            className="min-w-36 rounded-lg"
            disabled={!actions.canInstall(listing) || actions.busy(listing)}
            onClick={() => actions.install(listing, offer.version)}
          >
            {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
            {pending ? "Applying…" : `${LABELS[offer.state]} ${offer.version}`}
          </Button>
        ) : (
          // A settled state is not an offer: never a filled primary.
          <Button variant="secondary" disabled className="min-w-36 rounded-lg">
            {action.state === "installed" && <Check aria-hidden="true" />}
            {action.state === "installed" ? "Installed" : "Choose a version"}
          </Button>
        )}
        <SecondaryAction listing={listing} />
        <Select value={version} onValueChange={onVersionChange}>
          <SelectTrigger
            aria-label="Exact version"
            className="order-last w-full text-xs sm:order-none sm:w-auto sm:min-w-40"
          >
            <SelectValue placeholder="Choose a version" />
          </SelectTrigger>
          <SelectContent>
            {orphan && (
              <SelectItem value={installedVersion} className="text-xs">
                <span className="font-mono">{installedVersion}</span> · installed, not in catalog
              </SelectItem>
            )}
            {listing.versions.map((entry) => (
              <SelectItem key={entry.version} value={entry.version} className="text-xs">
                <span className="font-mono">{entry.version}</span>
                {entry.version === listing.recommended ? " · recommended" : ""}
                {entry.version === installedVersion ? " · installed" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <p className="text-xs text-muted-foreground">
        {listing.recommended
          ? `Recommended for this machine: ${listing.recommended}.`
          : "No compatible version is recommended for this machine — choose one explicitly."}{" "}
        {listing.installed ? "Nothing changes until you choose another version." : ""}
        {!actions.canInstall(listing) && listing.inCatalog
          ? " Installing needs a current verified catalog and a loaded inventory."
          : ""}
      </p>
    </div>
  );
}

/** Theme: put it on screen. Provider: whether it starts with Cadencr. */
function SecondaryAction({ listing }: { listing: MarketplaceListing }): React.JSX.Element | null {
  const { providers, themes, themeLoading } = useMarketplaceState();
  const installed = listing.installed;
  if (!installed) return null;
  if (listing.kind === "theme")
    return (
      <Button
        variant="outline"
        className="rounded-lg"
        disabled={
          installed.active || !installed.usable || themeLoading || themes.mutation.isPending
        }
        onClick={() => themes.mutation.mutate({ kind: "apply", id: listing.id })}
      >
        {installed.active ? "In use" : "Use this theme"}
      </Button>
    );
  return (
    <Button
      variant="outline"
      className="rounded-lg"
      disabled={providers.mutation.isPending}
      onClick={() =>
        providers.mutation.mutate({ kind: "enabled", id: listing.id, enabled: !installed.enabled })
      }
    >
      <Power aria-hidden="true" />
      {installed.enabled ? "Disable" : "Enable"}
    </Button>
  );
}
