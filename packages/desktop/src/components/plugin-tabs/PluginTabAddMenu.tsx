import { useState, type ReactElement, type ReactNode } from "react";
import {
  BugIcon,
  CheckIcon,
  FolderGit2Icon,
  Loader2Icon,
  PlusIcon,
  RotateCwIcon,
  Settings2Icon,
  SparklesIcon,
} from "lucide-react";

import type { PluginTabSummary } from "@/api/generated";
import { ShortcutTooltip } from "@/components/ShortcutTooltip";
import { useOpenCustomTabProject } from "@/components/settings/custom-tabs/useOpenCustomTabProject";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { apiErrorMessage, toastError } from "@/lib/api-errors";
import { SuppressBrowserViewWhileOpen } from "@/lib/browser-suppression";
import { desktopBridge } from "@/lib/desktop-bridge";
import { pluginTabInstanceId } from "@/lib/plugin-tabs/instance-id";
import { refreshPluginTabsOrToast, reloadLivePluginTab } from "@/lib/plugin-tabs/live-instances";
import { pluginIdOfTab, pluginTabKind } from "@/stores/feature-layout-schema";
import {
  getFocusedTab,
  selectFeatureLayout,
  useFeatureLayoutStore,
} from "@/stores/feature-layout-store";

import { PluginTabIcon } from "./PluginTabIcon";
import { usePlacedPluginTabsKey, useProjectPluginTabs } from "./usePluginTabDefs";
import { usePluginTabNavigation, type PluginTabNavigation } from "./usePluginTabNavigation";

interface PluginTabAddMenuProps {
  featureId: number;
  projectId: number;
}

/**
 * The root strip's "+": add one of the project's custom tabs to this feature
 * (or jump to it when it is already placed), manage or create custom tabs,
 * and — when a custom tab is focused — reload it or open its DevTools.
 */
export function PluginTabAddMenu({ featureId, projectId }: PluginTabAddMenuProps): ReactElement {
  const [open, setOpen] = useState(false);
  const navigation = usePluginTabNavigation();
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <ShortcutTooltip label="Add custom tab" alignRight disabled={open}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-7" aria-label="Add custom tab">
            <PlusIcon className="size-4" />
          </Button>
        </DropdownMenuTrigger>
      </ShortcutTooltip>
      <DropdownMenuContent align="end" className="w-72">
        {/* The menu portals over the pane area, where a native guest would cover it. */}
        <SuppressBrowserViewWhileOpen />
        {open && (
          <PluginTabMenuBody featureId={featureId} projectId={projectId} navigation={navigation} />
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PluginTabMenuBody({
  featureId,
  projectId,
  navigation,
}: PluginTabAddMenuProps & { navigation: PluginTabNavigation }): ReactElement {
  const query = useProjectPluginTabs(projectId, true);
  const placed = usePlacedPluginTabsKey(featureId, true);
  const focusedTab = useFeatureLayoutStore((state) =>
    getFocusedTab(selectFeatureLayout(featureId)(state)),
  );
  const focusedPluginId = focusedTab ? pluginIdOfTab(focusedTab) : null;
  const focused = query.data?.find((tab) => tab.id === focusedPluginId) ?? null;
  const placedIds = new Set(placed.split("|"));
  const enabledTabs = query.data?.filter((tab) => tab.enablement.effective) ?? [];

  return (
    <>
      <DropdownMenuLabel className="text-xs text-muted-foreground">Custom tabs</DropdownMenuLabel>
      <AvailableTabs
        state={query}
        tabs={enabledTabs}
        isPlaced={(tab) => placedIds.has(pluginTabKind(tab.id))}
        onSelect={(tab) =>
          useFeatureLayoutStore.getState().addTab(featureId, pluginTabKind(tab.id))
        }
      />
      {focused && (
        <>
          <DropdownMenuSeparator />
          <FocusedTabActions featureId={featureId} tab={focused} />
        </>
      )}
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={navigation.openSettings}>
        <Settings2Icon />
        Manage custom tabs…
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={navigation.openCreate}>
        <SparklesIcon />
        Create custom tab…
      </DropdownMenuItem>
    </>
  );
}

interface TabsQueryState {
  isLoading: boolean;
  error: unknown;
}

function AvailableTabs({
  state,
  tabs,
  isPlaced,
  onSelect,
}: {
  state: TabsQueryState;
  tabs: readonly PluginTabSummary[];
  isPlaced: (tab: PluginTabSummary) => boolean;
  onSelect: (tab: PluginTabSummary) => void;
}): ReactNode {
  if (state.isLoading) {
    return (
      <MenuNote>
        <Loader2Icon className="size-3.5 animate-spin" aria-hidden />
        Loading custom tabs…
      </MenuNote>
    );
  }
  if (state.error) {
    return (
      <MenuNote tone="error">
        {apiErrorMessage(state.error, "Custom tabs could not be listed")}
      </MenuNote>
    );
  }
  if (tabs.length === 0) {
    return <MenuNote>No custom tab is on for this project yet.</MenuNote>;
  }
  return tabs.map((tab) => {
    const placed = isPlaced(tab);
    return (
      <DropdownMenuItem
        key={tab.id}
        onSelect={() => onSelect(tab)}
        className="items-start"
        aria-label={placed ? `${tab.label} (open)` : tab.label}
      >
        <PluginTabIcon svg={tab.icon_svg} className="mt-0.5" />
        <span className="min-w-0 flex-1">
          <span className="block truncate">{tab.label}</span>
          {tab.description ? (
            <span className="line-clamp-2 text-xs text-muted-foreground">{tab.description}</span>
          ) : null}
        </span>
        {placed ? <CheckIcon className="mt-0.5 size-4" aria-hidden /> : null}
      </DropdownMenuItem>
    );
  });
}

function FocusedTabActions({
  featureId,
  tab,
}: {
  featureId: number;
  tab: PluginTabSummary;
}): ReactElement {
  const instanceId = pluginTabInstanceId(featureId, tab.id);
  const projectOpener = useOpenCustomTabProject();
  return (
    <>
      <DropdownMenuLabel className="truncate text-xs text-muted-foreground">
        {tab.label}
      </DropdownMenuLabel>
      <DropdownMenuItem
        onSelect={() => {
          // A tab showing a state (not built, invalid…) has no guest: re-read it.
          if (!reloadLivePluginTab(instanceId)) refreshPluginTabsOrToast();
        }}
      >
        <RotateCwIcon />
        Reload
      </DropdownMenuItem>
      <DropdownMenuItem
        onSelect={() => {
          void desktopBridge.pluginTabs
            .openDevTools(instanceId)
            .catch((error: unknown) => toastError(error, "DevTools could not be opened"));
        }}
      >
        <BugIcon />
        Open DevTools
      </DropdownMenuItem>
      {tab.authoring_project_id != null && (
        <DropdownMenuItem
          disabled={projectOpener.openingId === tab.id}
          onSelect={() => projectOpener.open(tab.id, "Could not open the custom tab's project")}
        >
          <FolderGit2Icon />
          Open source project
        </DropdownMenuItem>
      )}
    </>
  );
}

function MenuNote({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "error";
}): ReactElement {
  return (
    <p
      className={
        tone === "error"
          ? "flex items-center gap-2 px-2 py-1.5 text-xs text-destructive"
          : "flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground"
      }
    >
      {children}
    </p>
  );
}
