import { memo } from "react";
import { Link } from "@tanstack/react-router";
import { displayVersion, type MarketplaceListing } from "@/lib/marketplace-listings";
import { cn } from "@/lib/utils";
import { KINDS } from "./kinds";
import { PluginArt } from "./PluginArt";
import { describe, KindChips, PluginStateBadge } from "./PluginBits";

/** A catalog entry: its artwork first, then name, state, publisher and what it adds. */
export const MarketplaceTile = memo(function MarketplaceTile({
  listing,
}: {
  listing: MarketplaceListing;
}): React.JSX.Element {
  const version = displayVersion(listing);
  return (
    <Link
      to="/marketplace/$kind/$id"
      params={{ kind: listing.kind, id: listing.id }}
      className={cn(
        "mp-tile group flex h-full flex-col overflow-hidden rounded-lg",
        KINDS[listing.kind].tone,
      )}
    >
      <div className="mp-tile-art">
        <PluginArt listing={listing} variant="tile" />
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <div className="flex items-start gap-2">
          <h3 className="min-w-0 flex-1 truncate text-[13.5px] font-semibold leading-5">
            {listing.name}
          </h3>
          <PluginStateBadge listing={listing} />
        </div>
        <p className="truncate text-[11px] text-muted-foreground">
          {listing.publisher}
          {listing.publisher && version && " · "}
          {version && <span className="font-mono text-[10.5px]">v{version}</span>}
        </p>
        <p className="line-clamp-2 text-[12.5px] leading-[1.45] text-muted-foreground">
          {describe(listing)}
        </p>
        <div className="mt-auto pt-1.5">
          <KindChips kinds={listing.contributes} />
        </div>
      </div>
    </Link>
  );
});
