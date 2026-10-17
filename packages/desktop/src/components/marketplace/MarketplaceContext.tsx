import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useMarketplace } from "@/hooks/useMarketplace";
import { useThemeMarketplace } from "@/hooks/useThemeMarketplace";
import { useTheme } from "@/hooks/useTheme";
import { buildListings, type MarketplaceListing } from "@/lib/marketplace-listings";
import { usableCatalog } from "@/lib/marketplace";
import { usableThemeCatalog } from "@/lib/theme-marketplace";

interface MarketplaceState {
  providers: ReturnType<typeof useMarketplace>;
  themes: ReturnType<typeof useThemeMarketplace>;
  listings: MarketplaceListing[];
  themeLoading: boolean;
  loading: boolean;
  /** At least one kind has a current, verified catalog to install from. */
  catalogUsable: { provider: boolean; theme: boolean };
  /** "Update all" is walking its queue (kept here so it survives navigation). */
  updatingAll: boolean;
  setUpdatingAll: (running: boolean) => void;
}

const MarketplaceContext = createContext<MarketplaceState | null>(null);

/**
 * Owns both kinds' queries and mutations above the list and detail routes, so
 * a pending install, its result and its failure survive moving between them.
 */
export function MarketplaceProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const providers = useMarketplace();
  const themes = useThemeMarketplace();
  const { themeId, isLoading: themeLoading } = useTheme();
  const [updatingAll, setUpdatingAll] = useState(false);
  const providerCatalog = providers.catalogQuery.data;
  const providerInventory = providers.inventoryQuery.data;
  const themeCatalog = themes.catalog.data;
  const themeInventory = themes.inventory.data;
  const listings = useMemo(
    () =>
      buildListings({
        providerCatalog,
        providerInventory: providerInventory?.providers,
        themeCatalog,
        themeInventory,
        displayedThemeId: themeId,
      }),
    [providerCatalog, providerInventory, themeCatalog, themeInventory, themeId],
  );
  const loading =
    providers.catalogQuery.isPending ||
    providers.inventoryQuery.isPending ||
    themes.catalog.isPending ||
    themes.inventory.isPending;
  const value = useMemo(
    () => ({
      providers,
      themes,
      listings,
      themeLoading,
      loading,
      catalogUsable: {
        provider: usableCatalog(providerCatalog),
        theme: usableThemeCatalog(themeCatalog),
      },
      updatingAll,
      setUpdatingAll,
    }),
    [
      providers,
      themes,
      listings,
      themeLoading,
      loading,
      providerCatalog,
      themeCatalog,
      updatingAll,
    ],
  );
  return <MarketplaceContext.Provider value={value}>{children}</MarketplaceContext.Provider>;
}

export function useMarketplaceState(): MarketplaceState {
  const state = useContext(MarketplaceContext);
  if (!state) throw new Error("useMarketplaceState must be used inside <MarketplaceProvider>");
  return state;
}
