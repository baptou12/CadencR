import type { ReactElement } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Check, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LENS_OPTIONS } from "@/components/sidebar-display-rows";
import { useSetSidebarOption } from "@/hooks/useSidebarSettings";
import { useSidebarViews } from "@/hooks/useSidebarViews";
import type { SidebarLens } from "@/lib/sidebar-lens";
import { useSidebarOption } from "@/stores/sidebar-config-store";

/** The name the Projects header takes: the shown view's, else the lens's. */
function headerName(lens: SidebarLens, viewName: string | undefined): string {
  if (viewName !== undefined) return viewName || "Untitled view";
  if (lens === "project") return "Projects";
  if (lens === "flat") return "Conversations";
  const label = LENS_OPTIONS.find((option) => option.value === lens)?.label ?? lens;
  return `By ${label.toLowerCase()}`;
}

function MenuCheck({ on }: { on: boolean }): ReactElement {
  return <Check className={on ? "size-3.5" : "size-3.5 opacity-0"} />;
}

/**
 * The Projects header's name, as a menu: how conversations are grouped (the
 * "Group by" option) and the saved views, one click away.
 */
export function SidebarLensMenu(): ReactElement {
  const lens = useSidebarOption("lens");
  const setOption = useSetSidebarOption();
  const { views, activeView, showView } = useSidebarViews();
  const navigate = useNavigate();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-sidebar-lens-menu
        className="flex min-w-0 items-center gap-1 rounded-sm text-xs font-semibold uppercase text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground"
      >
        <span className="truncate">{headerName(lens, activeView?.name)}</span>
        <ChevronDown className="size-3 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-44">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Group by</DropdownMenuLabel>
        {LENS_OPTIONS.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onSelect={() => {
              if (activeView) showView(null);
              if (option.value !== lens) setOption("lens", option.value);
            }}
          >
            <MenuCheck on={activeView === null && option.value === lens} />
            {option.label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">Views</DropdownMenuLabel>
        {views.map((view) => (
          <DropdownMenuItem key={view.id} onSelect={() => showView(view.id)}>
            <MenuCheck on={view.id === activeView?.id} />
            <span className="truncate">{view.name || "Untitled view"}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem
          onSelect={() => void navigate({ to: "/settings", search: { section: "sidebar-views" } })}
        >
          <MenuCheck on={false} />
          {views.length === 0 ? "Create a view…" : "Manage views…"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
