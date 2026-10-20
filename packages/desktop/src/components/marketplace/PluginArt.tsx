import { Loader2, Paintbrush, PanelTop } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useThemeArt } from "@/hooks/useThemePreview";
import { marketplaceError } from "@/lib/marketplace";
import { displayVersion, type MarketplaceListing } from "@/lib/marketplace-listings";
import { useMarketplaceState } from "./MarketplaceContext";
import { ProviderStage, ThemeStage } from "./PluginStages";

type Variant = "tile" | "spotlight" | "detail";

/**
 * A plugin at the scale it lives at in Cadencr, for every surface that shows
 * one: tiles (passive), the showcase and the detail page (with a preview
 * action for themes whose colors are not loaded yet).
 */
export function PluginArt({
  listing,
  variant,
  version = displayVersion(listing),
}: {
  listing: MarketplaceListing;
  variant: Variant;
  version?: string;
}): React.JSX.Element {
  if (listing.kind === "tab") return <TabArt listing={listing} />;
  if (listing.kind === "provider")
    return <ProviderStage listing={listing} compact={variant === "tile"} />;
  return <ThemeArt key={version} listing={listing} variant={variant} version={version} />;
}

function ThemeArt({
  listing,
  variant,
  version,
}: {
  listing: MarketplaceListing;
  variant: Variant;
  version?: string;
}): React.JSX.Element {
  const { themes } = useMarketplaceState();
  const art = useThemeArt(themes.inventory.data, themes.catalog.data?.index, listing, version);
  const error = marketplaceError(art.error);
  if (art.definition)
    return (
      <>
        <ThemeStage definition={art.definition} />
        {variant === "detail" && (
          <span className="absolute bottom-3 left-3 rounded-full bg-background/85 px-2.5 py-1 text-[11px] text-muted-foreground">
            {art.installed ? `Installed ${version}` : `Preview of ${version} — not installed`}
          </span>
        )}
      </>
    );
  return (
    <>
      <ThemeStage definition={null} />
      {variant === "tile" ? (
        <div className="absolute inset-0 grid place-items-center">
          {error ? (
            <span className="max-w-[85%] text-center text-[11px] text-destructive">{error}</span>
          ) : art.isFetching ? (
            <Loader2
              aria-label="Loading preview"
              className="size-4 animate-spin text-muted-foreground"
            />
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-background/80 px-2.5 py-1 text-[11px] text-muted-foreground">
              <Paintbrush aria-hidden="true" className="size-3" />
              Preview not loaded
            </span>
          )}
        </div>
      ) : (
        <div className="absolute inset-x-3 bottom-3 flex flex-wrap items-center gap-2 rounded-lg bg-background/90 px-3 py-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!art.canPreview || art.isFetching}
            onClick={art.preview}
          >
            {art.isFetching ? (
              <Loader2 aria-hidden="true" className="animate-spin" />
            ) : (
              <Paintbrush aria-hidden="true" />
            )}
            {art.isFetching ? "Painting preview…" : `Preview ${version ?? "colors"}`}
          </Button>
          <span className="text-[11px] text-muted-foreground">
            From the verified archive, without installing.
          </span>
          {error && (
            <span role="alert" className="w-full text-[11px] text-destructive">
              {error}
            </span>
          )}
        </div>
      )}
    </>
  );
}

function TabArt({ listing }: { listing: MarketplaceListing }): React.JSX.Element {
  return (
    <div
      className="mp-kind-tab flex h-full w-full flex-col bg-card p-4"
      aria-label="Custom workspace tab"
    >
      <div className="flex items-center gap-2 border-b border-border pb-2 text-xs font-medium text-[var(--mp-kind)]">
        <PanelTop className="size-3.5" aria-hidden />
        {listing.name}
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
        <PanelTop className="size-8" aria-hidden />
        <span className="text-xs">Custom workspace tab</span>
      </div>
    </div>
  );
}
