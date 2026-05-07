import type { ReactElement } from "react";
import { Link } from "@tanstack/react-router";
import { PanelLeft, Settings } from "lucide-react";
import { AppEnvironmentBadge } from "@/components/AppEnvironmentBadge";
import { CadencrLogo } from "@/components/CadencrLogo";
import { Button } from "@/components/ui/button";

export function SidebarCollapsedChrome({ onExpand }: { onExpand: () => void }): ReactElement {
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
