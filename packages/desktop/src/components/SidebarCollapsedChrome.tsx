import type { ReactElement } from "react";
import { Link } from "@tanstack/react-router";
import { PanelLeft, Settings } from "lucide-react";
import { AppEnvironmentBadge } from "@/components/AppEnvironmentBadge";
import { CadencrLogo } from "@/components/CadencrLogo";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/useIsMobile";

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
  return (
    <>
      {/* `mt-2` keeps the logo clear of the macOS traffic-light buttons,
          which sit at ~y=12 inside `titleBarStyle: "hiddenInset"`. */}
      <div className="group/logo -ml-2 mt-2 flex shrink-0 items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 opacity-0 transition-opacity group-hover/logo:opacity-100"
          title="Expand sidebar (⌘B)"
          onClick={onExpand}
        >
          <PanelLeft className="size-4" />
        </Button>
        <CadencrLogo className="size-9 shrink-0 -translate-y-px" />
        <span
          className="text-xl font-bold uppercase leading-none tracking-widest"
          style={{ fontFamily: "'Avenir Next', 'Montserrat', 'Helvetica Neue', sans-serif" }}
        >
          Cadencr
        </span>
        <AppEnvironmentBadge
          className="ml-1 self-start"
          kind={import.meta.env.DEV ? "dev" : "beta"}
        />
        <Link
          to="/settings"
          className="ml-1 opacity-0 transition-opacity group-hover/logo:opacity-100"
        >
          <Button variant="ghost" size="icon" className="size-7">
            <Settings className="size-4" />
            <span className="sr-only">Settings</span>
          </Button>
        </Link>
      </div>
      <div className="mx-1 h-5 w-px bg-border" />
    </>
  );
}
