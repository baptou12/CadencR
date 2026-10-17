import { useMemo } from "react";
import type { MarketplaceListing } from "@/lib/marketplace-listings";
import { useMarketplaceState } from "./MarketplaceContext";

const NO_CATALOG = "A current signed catalog is required to install.";

interface Callbacks {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

/**
 * Install/update dispatch for either kind. Every request carries the exact
 * version and the untouched signed envelope; nothing changes on screen until
 * the backend confirms (inventories are refetched by the kind's own hook).
 */
export function usePluginActions() {
  const { providers, themes, catalogUsable } = useMarketplaceState();
  return useMemo(() => {
    const providerReady =
      catalogUsable.provider &&
      !!providers.inventoryQuery.data &&
      !providers.inventoryQuery.isError &&
      providers.inventoryQuery.data.trust.status === "configured";
    const themeReady = catalogUsable.theme && themes.inventory.isSuccess;
    const mutationOf = (listing: MarketplaceListing) =>
      listing.kind === "provider" ? providers.mutation : themes.mutation;

    /** Install, or move an installed plugin to `version`. The one kind branch. */
    const send = (listing: MarketplaceListing, version: string, callbacks?: Callbacks) => {
      const kind = listing.installed ? "update" : "install";
      const providerIndex = providers.catalogQuery.data?.index;
      const themeIndex = themes.catalog.data?.index;
      if (listing.kind === "provider" && providerIndex)
        providers.mutation.mutate(
          { kind, id: listing.id, version, index: providerIndex },
          callbacks,
        );
      else if (listing.kind === "theme" && themeIndex)
        themes.mutation.mutate({ kind, id: listing.id, version, index: themeIndex }, callbacks);
      else throw new Error(NO_CATALOG);
    };

    return {
      /** Whether this kind can install or update right now. */
      canInstall: (listing: MarketplaceListing) =>
        listing.inCatalog && (listing.kind === "provider" ? providerReady : themeReady),
      /** A change for this kind is in flight (one at a time per kind). */
      busy: (listing: MarketplaceListing) => mutationOf(listing).isPending,
      /** A change for this exact plugin is in flight. */
      pending: (listing: MarketplaceListing) => {
        const mutation = mutationOf(listing);
        return mutation.isPending && mutation.variables?.id === listing.id;
      },
      install: (listing: MarketplaceListing, version: string) => send(listing, version),
      /**
       * Each pending update in turn, at its exact recommended version. Rejects
       * on the first failure so the caller can say why the queue stopped.
       */
      updateAll: async (listings: MarketplaceListing[]) => {
        for (const listing of listings) {
          const version = listing.update;
          if (!version) continue;
          await new Promise<void>((resolve, reject) => {
            try {
              send(listing, version, { onSuccess: () => resolve(), onError: reject });
            } catch (error) {
              reject(error instanceof Error ? error : new Error(NO_CATALOG));
            }
          });
        }
      },
    };
  }, [providers, themes, catalogUsable]);
}
