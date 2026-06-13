import { useState, type ComponentType, type ReactElement } from "react";
import {
  AlertTriangleIcon,
  EyeOffIcon,
  CookieIcon,
  GlobeIcon,
  Loader2Icon,
  PlusIcon,
  XIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { PROFILE_ID, type CookieMode } from "@/lib/browser-settings";
import type { BrowserTabMetadata } from "@/lib/desktop-bridge";
import type { BrowserWorkspaceModel } from "./useBrowserWorkspaceModel";

export function BrowserTabStrip({ model }: { model: BrowserWorkspaceModel }): ReactElement {
  return (
    <div className="flex items-center gap-1">
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {model.state.tabs.map((tab) => (
          <BrowserTabPill
            key={tab.id}
            tab={tab}
            onActivate={model.activateTab}
            onClose={model.closeTab}
          />
        ))}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          onClick={() => void model.newTab()}
          aria-label="New browser tab"
        >
          <PlusIcon className="size-4" />
        </Button>
      </div>
      <BrowserModeToggle mode={model.mode} onModeChange={model.setMode} />
    </div>
  );
}

function BrowserModeToggle({
  mode,
  onModeChange,
}: {
  mode: CookieMode;
  onModeChange: (mode: CookieMode) => void;
}): ReactElement {
  return (
    <div
      role="group"
      aria-label="Cookie mode"
      className="ml-auto flex shrink-0 items-center rounded-md border bg-muted/50 p-0.5"
    >
      <BrowserModeButton
        active={mode === "normal"}
        icon={CookieIcon}
        label="Normal"
        title="Reuse existing cookies and logins"
        onClick={() => onModeChange("normal")}
      />
      <BrowserModeButton
        active={mode === "private"}
        icon={EyeOffIcon}
        label="Private"
        title="Start fresh with no cookies"
        onClick={() => onModeChange("private")}
      />
    </div>
  );
}

function BrowserModeButton({
  active,
  icon: Icon,
  label,
  title,
  onClick,
}: {
  active: boolean;
  icon: ComponentType<{ className?: string }>;
  label: string;
  title: string;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      aria-pressed={active}
      title={title}
      onClick={onClick}
      className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors ${active ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"}`}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  );
}

function BrowserTabPill({
  tab,
  onActivate,
  onClose,
}: {
  tab: BrowserTabMetadata;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
}): ReactElement {
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
        <BrowserTabIcon tab={tab} />
        <span className="truncate">{tab.title || "New tab"}</span>
      </button>
      <button
        type="button"
        aria-label="Close tab"
        className="flex size-4 shrink-0 items-center justify-center rounded opacity-0 transition-opacity hover:bg-muted-foreground/20 group-hover/tab:opacity-100"
        onClick={() => onClose(tab.id)}
      >
        <XIcon className="size-3" />
      </button>
    </div>
  );
}

function BrowserTabIcon({ tab }: { tab: BrowserTabMetadata }): ReactElement {
  if (tab.loading) return <Loader2Icon className="size-3.5 shrink-0 animate-spin text-primary" />;
  if (tab.sessionProfileId === PROFILE_ID.private)
    return <EyeOffIcon className="size-3.5 shrink-0 opacity-70" aria-label="Private tab" />;
  // `key` resets the error fallback whenever the tab loads a different favicon.
  if (tab.faviconUrl) return <BrowserFavicon key={tab.faviconUrl} url={tab.faviconUrl} />;
  return <GlobeIcon className="size-3.5 shrink-0 opacity-70" />;
}

// The page favicon, falling back to the globe glyph if it fails to load (broken
// URL, blocked request) so a tab never shows a missing-image placeholder.
function BrowserFavicon({ url }: { url: string }): ReactElement {
  const [failed, setFailed] = useState(false);
  if (failed) return <GlobeIcon className="size-3.5 shrink-0 opacity-70" />;
  return (
    <img
      src={url}
      alt=""
      className="size-3.5 shrink-0 rounded-sm"
      onError={() => setFailed(true)}
    />
  );
}

export function BrowserLoading(): ReactElement {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-background text-muted-foreground">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted">
        <GlobeIcon className="size-6 animate-pulse" />
      </div>
      <div className="flex items-center gap-2 text-sm">
        <Loader2Icon className="size-4 animate-spin" /> Starting browser…
      </div>
    </div>
  );
}

export function BrowserEmptyState({ onNewTab }: { onNewTab: () => void }): ReactElement {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <GlobeIcon className="size-7" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">No browser tab open</p>
        <p className="max-w-xs text-xs text-muted-foreground">
          Open a tab to preview your app, then send the page context straight to the agent.
        </p>
      </div>
      <Button size="sm" onClick={onNewTab}>
        <PlusIcon className="size-4" />
        New tab
      </Button>
    </div>
  );
}

export function BrowserError({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}): ReactElement {
  return (
    <div className="flex items-center gap-2 border-b border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
      <AlertTriangleIcon className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{message}</span>
      <button
        type="button"
        aria-label="Dismiss browser error"
        className="rounded p-1 hover:bg-destructive/15"
        onClick={onDismiss}
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  );
}
