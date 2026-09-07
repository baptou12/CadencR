import { memo, useState, type ReactElement } from "react";
import { ChevronDownIcon, EyeOffIcon, GlobeIcon, Loader2Icon, PlusIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PROFILE_ID, type CookieMode } from "@/lib/browser-settings";
import type { BrowserTabMetadata } from "@/lib/desktop-bridge";
import { MAX_BROWSER_FAVICON_DATA_URL_LENGTH } from "@/shared/browser-types";
import type { BrowserWorkspaceModel } from "./useBrowserWorkspaceModel";

const SAFE_FAVICON_DATA_URL =
  /^data:image\/(?:png|jpeg|gif|webp|x-icon|vnd\.microsoft\.icon);base64,[a-z\d+/]+={0,2}$/iu;

interface BrowserTabStripProps {
  model: BrowserWorkspaceModel;
  onChromeOverlayOpenChange?: (open: boolean) => void;
}

export function BrowserTabStrip({
  model,
  onChromeOverlayOpenChange,
}: BrowserTabStripProps): ReactElement {
  return (
    <div className="flex min-w-0 items-center gap-1">
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {model.state.tabs.map((tab) => (
          <BrowserTabPill
            key={tab.id}
            tab={tab}
            onActivate={model.activateTab}
            onClose={model.closeTab}
          />
        ))}
        <NewBrowserTabButton
          defaultMode={model.defaultMode}
          creatingMode={model.creatingMode}
          onNewTab={model.newTab}
          onOpenChange={onChromeOverlayOpenChange}
        />
      </div>
    </div>
  );
}

const NewBrowserTabButton = memo(function NewBrowserTabButton({
  defaultMode,
  creatingMode,
  onNewTab,
  onOpenChange,
}: {
  defaultMode: CookieMode;
  creatingMode: CookieMode | null;
  onNewTab: (mode?: CookieMode) => Promise<void>;
  onOpenChange?: (open: boolean) => void;
}): ReactElement {
  const creating = creatingMode !== null;
  const defaultLabel = defaultMode === "private" ? "Private" : "Normal";
  const primaryLabel = creating
    ? `Opening ${creatingMode === "private" ? "private " : ""}browser tab`
    : `New browser tab (default: ${defaultLabel})`;
  return (
    <div className="flex shrink-0 items-center">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="h-7 rounded-r-none px-1.5"
        disabled={creating}
        aria-busy={creating}
        aria-label={primaryLabel}
        title={primaryLabel}
        onClick={() => void onNewTab()}
      >
        {creating ? (
          <Loader2Icon className="size-3.5 animate-spin" />
        ) : (
          <PlusIcon className="size-4" />
        )}
      </Button>
      <DropdownMenu onOpenChange={onOpenChange}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="h-7 w-5 rounded-l-none border-l px-0"
            disabled={creating}
            aria-label="Choose browser tab type"
            title="Choose browser tab type"
          >
            <ChevronDownIcon className="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-48">
          <DropdownMenuItem onSelect={() => void onNewTab("normal")}>
            <GlobeIcon />
            New tab (normal)
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void onNewTab("private")}>
            <EyeOffIcon />
            New private tab
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
});

const BrowserTabPill = memo(function BrowserTabPill({
  tab,
  onActivate,
  onClose,
}: {
  tab: BrowserTabMetadata;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
}): ReactElement {
  const label = tab.title || "New tab";
  const isPrivate = tab.sessionProfileId === PROFILE_ID.private;
  return (
    <div
      aria-current={tab.isActive ? "page" : undefined}
      className={`group/tab flex h-7 max-w-48 shrink-0 items-center gap-1.5 rounded-md pl-2 pr-1 text-xs transition-colors ${tab.isActive ? "bg-primary/15 font-medium text-foreground shadow-xs ring-1 ring-inset ring-primary/60" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"}`}
    >
      <button
        type="button"
        className="flex min-w-0 items-center gap-1.5"
        onClick={() => onActivate(tab.id)}
        title={tab.title || tab.url}
      >
        <span className="flex shrink-0 items-center gap-1">
          <BrowserPageIcon tab={tab} />
          {isPrivate ? (
            <span role="img" aria-label="Private tab" title="Private tab">
              <EyeOffIcon aria-hidden="true" className="size-3 shrink-0 opacity-70" />
            </span>
          ) : null}
        </span>
        <span className="truncate">{label}</span>
      </button>
      <button
        type="button"
        aria-label={`Close ${label}`}
        className="flex size-4 shrink-0 items-center justify-center rounded opacity-0 transition-opacity hover:bg-muted-foreground/20 focus-visible:opacity-100 group-hover/tab:opacity-100"
        onClick={() => onClose(tab.id)}
      >
        <XIcon className="size-3" />
      </button>
    </div>
  );
});

function BrowserPageIcon({ tab }: { tab: BrowserTabMetadata }): ReactElement {
  if (tab.loading) {
    return (
      <span role="status" aria-label="Tab loading">
        <Loader2Icon aria-hidden="true" className="size-3.5 shrink-0 animate-spin text-primary" />
      </span>
    );
  }
  if (isSafeFaviconDataUrl(tab.faviconUrl)) {
    return <BrowserFavicon key={tab.faviconUrl} url={tab.faviconUrl} />;
  }
  return <GlobeIcon aria-hidden="true" className="size-3.5 shrink-0 opacity-70" />;
}

function isSafeFaviconDataUrl(url: string | undefined): url is string {
  return Boolean(
    url && url.length <= MAX_BROWSER_FAVICON_DATA_URL_LENGTH && SAFE_FAVICON_DATA_URL.test(url),
  );
}

// A broken or blocked favicon falls back without showing a missing-image glyph.
function BrowserFavicon({ url }: { url: string }): ReactElement {
  const [failed, setFailed] = useState(false);
  if (failed) return <GlobeIcon aria-hidden="true" className="size-3.5 shrink-0 opacity-70" />;
  return (
    <img
      src={url}
      alt=""
      className="size-3.5 shrink-0 rounded-sm"
      onError={() => setFailed(true)}
    />
  );
}
