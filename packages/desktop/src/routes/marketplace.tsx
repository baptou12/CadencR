import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { MarketplaceProvider } from "@/components/marketplace/MarketplaceContext";
import { MARKETPLACE_ENABLED } from "@/lib/marketplace-gate";

export const Route = createFileRoute("/marketplace")({
  // Unreleased: builds without the dev opt-in have no marketplace route at all.
  beforeLoad: () => {
    if (!MARKETPLACE_ENABLED) throw redirect({ to: "/" });
  },
  component: MarketplaceLayout,
});

/** One provider above the list and detail pages, so in-flight changes survive navigation. */
function MarketplaceLayout(): React.JSX.Element {
  return (
    <MarketplaceProvider>
      <Outlet />
    </MarketplaceProvider>
  );
}
