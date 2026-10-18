import { useState } from "react";
import { Copy, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { marketplaceError } from "@/lib/marketplace";
import type { MarketplaceListing } from "@/lib/marketplace-listings";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useMarketplaceState } from "./MarketplaceContext";

/** Removal across kinds and, for themes, duplicating into an editable author project. */
export function PluginManage({
  listing,
}: {
  listing: MarketplaceListing;
}): React.JSX.Element | null {
  const { providers, themes, tabs } = useMarketplaceState();
  const [confirming, setConfirming] = useState(false);
  const [label, setLabel] = useState("");
  if (!listing.installed) return null;
  const mutation =
    listing.kind === "provider"
      ? providers.mutation
      : listing.kind === "tab"
        ? tabs.mutation
        : themes.mutation;
  // The kind's mutation is shared; only this plugin's removal failure belongs in the dialog.
  const removalError =
    mutation.variables?.kind === "remove" && mutation.variables.id === listing.id
      ? marketplaceError(mutation.error)
      : null;
  /** Resolves false on failure so the dialog stays open on its error. */
  const remove = () =>
    new Promise<boolean>((resolve) => {
      const callbacks = { onSuccess: () => resolve(true), onError: () => resolve(false) };
      if (listing.kind === "provider")
        providers.mutation.mutate({ kind: "remove", id: listing.id }, callbacks);
      else if (listing.kind === "tab")
        tabs.mutation.mutate({ kind: "remove", id: listing.id }, callbacks);
      else
        themes.mutation.mutate(
          { kind: "remove", id: listing.id, confirmFallback: true },
          callbacks,
        );
    });
  return (
    <section className="space-y-3">
      <h2 className="text-[13px] font-semibold">Manage</h2>
      {listing.kind === "theme" && (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">
            Make an editable copy in a new author project.
          </p>
          <div className="flex gap-2">
            <Input
              aria-label={`New author project name for ${listing.name}`}
              placeholder="New theme name"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              disabled={themes.mutation.isPending}
              className="h-8 text-[13px]"
            />
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              disabled={themes.mutation.isPending || !listing.installed.usable || !label.trim()}
              onClick={() =>
                themes.mutation.mutate(
                  { kind: "duplicate", id: listing.id, label: label.trim() },
                  { onSuccess: () => setLabel("") },
                )
              }
            >
              <Copy aria-hidden="true" />
              Duplicate
            </Button>
          </div>
        </div>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="px-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
        disabled={mutation.isPending}
        onClick={() => setConfirming(true)}
      >
        <Trash2 aria-hidden="true" />
        Remove {listing.name}…
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Remove ${listing.name}?`}
        description={removalDescription(listing)}
        variant="destructive"
        confirmText={mutation.isPending ? "Removing…" : "Remove"}
        busy={mutation.isPending}
        onConfirm={remove}
      >
        {removalError && (
          <p role="alert" className="text-sm text-destructive">
            {removalError}
          </p>
        )}
      </ConfirmDialog>
    </section>
  );
}

function removalDescription(listing: MarketplaceListing): string {
  if (listing.kind === "provider")
    return "The provider is disabled and dropped from the next startup. Existing conversations are kept.";
  if (listing.kind === "tab")
    return "The tab is removed from the workspace. Its configuration and retained revisions are kept.";
  return "Any light, dark or manual selection using this theme returns to a built-in theme.";
}
