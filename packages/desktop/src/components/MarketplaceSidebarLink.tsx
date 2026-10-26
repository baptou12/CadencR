import { memo, type ReactElement } from "react";
import { Blocks } from "lucide-react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useMarketplaceUpdateCount } from "@/hooks/useMarketplaceListings";
import { MARKETPLACE_ENABLED } from "@/lib/marketplace-gate";
import { cn } from "@/lib/utils";

/**
 * Sidebar entry for the Marketplace, above Agents. Its badge counts installed
 * plugins with a newer compatible version — the one marketplace number worth
 * a glance from anywhere in the app. Builds without the marketplace opt-in
 * render nothing and mount no marketplace query.
 */
export function MarketplaceSidebarLink(): ReactElement | null {
  return MARKETPLACE_ENABLED ? <EnabledMarketplaceSidebarLink /> : null;
}

const EnabledMarketplaceSidebarLink = memo(function EnabledMarketplaceSidebarLink(): ReactElement {
  const active = useRouterState({
    select: (state) => state.location.pathname.startsWith("/marketplace"),
  });
  const updates = useMarketplaceUpdateCount();
  return (
    <Link
      to="/marketplace"
      data-nav-item
      data-nav-type="marketplace"
      title={updates ? `${updates} update${updates === 1 ? "" : "s"} available` : "Marketplace"}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none transition-colors",
        "focus-visible:bg-accent focus-visible:outline-none",
        active
          ? "bg-accent/50 text-accent-foreground font-medium"
          : "text-foreground hover:bg-accent/50",
      )}
    >
      <Blocks className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">Marketplace</span>
      {updates > 0 && (
        <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
          <span className="size-1.5 rounded-full bg-primary" />
          <span className="tabular-nums">{updates}</span>
        </span>
      )}
    </Link>
  );
});
