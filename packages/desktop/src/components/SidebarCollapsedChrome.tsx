import type { ReactElement } from "react";
import { Link } from "@tanstack/react-router";
import { PanelLeft, Settings } from "lucide-react";
import { AppEnvironmentBadge } from "@/components/AppEnvironmentBadge";
import { CadencrLogo } from "@/components/CadencrLogo";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/useIsMobile";
import { HAS_MAC_WINDOW_CONTROLS } from "@/lib/mac-window-controls";

export function SidebarCollapsedChrome({ onExpand }: { onExpand: () => void }): ReactElement {
  const isMobile = useIsMobile();
  // On phones the brand + settings already live inside the drawer, so the
  // collapsed chrome is just a menu button that opens it. Keeping the full
  // logo here would eat the narrow topbar.
  if (isMobile) {
    return (
      <Button
        variant="ghost"
        size="icon"
        className="-ml-1 size-8 shrink-0"
        title="Open menu"
        onClick={onExpand}
      >
        <PanelLeft className="size-5" />
        <span className="sr-only">Open menu</span>
      </Button>
    );
  }

  const actionsAndBrand = (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
        title="Expand sidebar (⌘B)"
        onClick={onExpand}
      >
        <PanelLeft className="size-4" />
      </Button>
      <Link to="/settings">
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground hover:text-foreground"
          title="Settings"
        >
          <Settings className="size-4" />
          <span className="sr-only">Settings</span>
        </Button>
      </Link>
      <CadencrLogo className="ml-0.5 size-9 shrink-0 -translate-y-px" />
      <span className="font-brand text-xl font-extrabold uppercase leading-none tracking-widest">
        Cadencr
      </span>
      <AppEnvironmentBadge
        className="ml-1 self-start"
        kind={import.meta.env.DEV ? "dev" : "beta"}
      />
    </>
  );

  return (
    <>
      {/* Mac: short strip under the traffic lights, then expand/settings + brand
          on one row. Non-Mac skips the strip. */}
      <div
        className={
          HAS_MAC_WINDOW_CONTROLS
            ? "-ml-2 flex shrink-0 flex-col md:-ml-3"
            : "-ml-2 flex shrink-0 items-center gap-0.5"
        }
      >
        {HAS_MAC_WINDOW_CONTROLS && <div className="h-3 shrink-0" aria-hidden />}
        <div className={HAS_MAC_WINDOW_CONTROLS ? "flex items-center gap-0.5 pl-1" : "contents"}>
          {actionsAndBrand}
        </div>
      </div>
      <div className="mx-1 h-5 w-px self-center bg-border" />
    </>
  );
}
