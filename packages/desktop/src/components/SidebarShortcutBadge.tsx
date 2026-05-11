import type { ReactElement } from "react";

export function SidebarShortcutBadge(): ReactElement {
  return (
    <span
      data-nav-shortcut-badge
      aria-hidden="true"
      hidden
      className="flex size-4 shrink-0 items-center justify-center rounded border border-sidebar-border bg-sidebar-accent text-[10px] font-medium leading-none text-sidebar-accent-foreground"
    />
  );
}
