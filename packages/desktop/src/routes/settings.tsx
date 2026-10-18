import { useEffect, useRef } from "react";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useShortcut } from "@/hooks/useShortcut";
import { Button } from "@/components/ui/button";
import { SidebarCollapsedChrome } from "@/components/SidebarCollapsedChrome";
import { useSidebarCollapsed } from "@/components/SidebarContext";
import { GeneralSettingsSections } from "@/components/settings/GeneralSettingsSections";
import { SettingsNavSidebar } from "@/components/settings/SettingsNavSidebar";
import { NAV_GROUPS } from "@/components/settings/settings-nav-groups";
import {
  isLegacyMarketplaceLink,
  parseSettingsSearch,
} from "@/components/settings/settings-navigation";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
  validateSearch: parseSettingsSearch,
  beforeLoad: ({ search }) => {
    if (isLegacyMarketplaceLink(search)) throw redirect({ to: "/marketplace" });
  },
});

function SettingsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const mainRef = useRef<HTMLElement | null>(null);
  const goBack = () => {
    void navigate({ to: "/" });
  };

  // Preserve the existing Escape behavior, including inside form controls.
  useShortcut("settings-back", (e) => {
    e.preventDefault();
    goBack();
  });

  useEffect(() => {
    if (!search.section) return;
    document.getElementById(search.section)?.scrollIntoView({ block: "start" });
  }, [search.section]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <SettingsPageHeader onBack={goBack} />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <SettingsNavSidebar groups={NAV_GROUPS} scrollRef={mainRef} />
        <main ref={mainRef} className="relative min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[820px] space-y-6 px-4 py-6 md:px-10 md:py-8">
            <GeneralSettingsSections />
            <div className="h-12" />
          </div>
        </main>
      </div>
    </div>
  );
}

function SettingsPageHeader({ onBack }: { onBack: () => void }): React.JSX.Element {
  const { collapsed, setCollapsed } = useSidebarCollapsed();
  return (
    <header className="titlebar-drag flex min-h-11 shrink-0 items-center gap-3 border-b border-border px-4 md:px-6">
      <SidebarCollapsedChrome visible={collapsed} onExpand={() => setCollapsed(false)} />
      <h1 className="min-w-0 flex-1 text-sm font-semibold">Settings</h1>
      <Button
        variant="ghost"
        size="sm"
        onClick={onBack}
        title="Back to workspace (Esc)"
        aria-label="Back to workspace"
        className="h-7 shrink-0 gap-1.5 px-2"
      >
        <ArrowLeft aria-hidden="true" className="size-3.5" />
        <span className="hidden sm:inline">Back</span>
      </Button>
    </header>
  );
}
