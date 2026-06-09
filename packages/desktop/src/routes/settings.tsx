import { useEffect, useRef, type ReactNode } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useShortcut } from "@/hooks/useShortcut";
import {
  ArrowLeft,
  Bell,
  BrainCircuit,
  ChevronRight,
  Code2,
  Files,
  GitMerge,
  History,
  Info,
  Keyboard,
  MonitorCog,
  Palette,
  Plug,
  Save,
  Settings2,
  ZoomIn,
} from "lucide-react";
import { CadencrLogo } from "@/components/CadencrLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ModelSelector } from "@/components/ModelSelector";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProviderIcon } from "@/lib/provider-icons";
import { CLAUDE_BYPASS_PERMISSIONS_SETTING_KEY } from "@/shared/permission-mode-settings";
import { BinaryDiscoverySection } from "@/components/settings/BinaryDiscoverySection";
import { CustomModelsSection } from "@/components/settings/CustomModelsSection";
import { DangerousModeToggle } from "@/components/settings/DangerousModeToggle";
import { CodexPermissionModeSetting } from "@/components/settings/CodexPermissionModeSetting";
import { ProfilesSection } from "@/components/settings/ProfilesSection";
import { GitSettings } from "@/components/settings/GitSettings";
import { NotificationsSection } from "@/components/settings/NotificationsSection";
import { AgentVerbositySettings } from "@/components/settings/AgentVerbositySettings";
import { ThemeSelector } from "@/components/settings/ThemeSelector";
import { FileTreeIconSetSelector } from "@/components/settings/FileTreeIconSetSelector";
import { LspServerList } from "@/components/settings/LspServerList";
import { AnimationsToggle } from "@/components/settings/AnimationsToggle";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { SettingsSubsection } from "@/components/settings/SettingsSubsection";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { SettingsSwitchRow } from "@/components/settings/SettingsSwitchRow";
import {
  SettingsNavSidebar,
  type SettingsNavGroup,
} from "@/components/settings/SettingsNavSidebar";
import { IconTile } from "@/components/settings/IconTile";
import { useZoom } from "@/hooks/useZoom";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useDebouncedSetting } from "@/hooks/useDebouncedSetting";
import { getProviderMetadata, PROVIDER_IDS, type ProviderId } from "@/lib/providers";
import { APP_VERSION } from "@/lib/app-version";
import { desktopBridge } from "@/lib/desktop-bridge";
import { useUpdateStore, type UpdateStatus } from "@/stores/update-store";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
  validateSearch: (search: Record<string, unknown>): { section?: string } => {
    if (typeof search.section === "string") return { section: search.section };
    return {};
  },
});

const NAV_GROUPS: SettingsNavGroup[] = [
  {
    label: "General",
    items: [
      {
        id: "appearance",
        label: "Appearance",
        icon: <Palette className="size-4" />,
      },
      { id: "editor", label: "Editor", icon: <Code2 className="size-4" /> },
      {
        id: "interface",
        label: "Interface & Zoom",
        icon: <MonitorCog className="size-4" />,
      },
      {
        id: "notifications",
        label: "Notifications",
        icon: <Bell className="size-4" />,
      },
    ],
  },
  {
    label: "Agents",
    items: [
      {
        id: "runtime",
        label: "Runtime & Models",
        icon: <BrainCircuit className="size-4" />,
      },
    ],
  },
  {
    label: "Source Control",
    items: [{ id: "git", label: "Git", icon: <GitMerge className="size-4" /> }],
  },
  {
    label: "Providers",
    items: [
      {
        id: "providers",
        label: "CLI Providers",
        icon: <Plug className="size-4" />,
      },
    ],
  },
  {
    label: "About",
    items: [
      {
        id: "about",
        label: "About Cadencr",
        icon: <Info className="size-4" />,
      },
    ],
  },
];

function SettingsPage() {
  const { section } = Route.useSearch();
  const navigate = useNavigate();
  const mainRef = useRef<HTMLElement | null>(null);

  const goBack = () => {
    void navigate({ to: "/" });
  };

  // Escape leaves the settings page. `useShortcut` defaults to firing from
  // inside form controls so users don't have to defocus first.
  useShortcut("settings-back", (e) => {
    e.preventDefault();
    goBack();
  });

  // Honor `?section=...` deep links — scroll once the layout has painted.
  useEffect(() => {
    if (!section) return;
    const target = document.getElementById(section);
    const main = mainRef.current;
    if (!target || !main) return;
    main.scrollTo({ top: target.offsetTop - 16 });
  }, [section]);

  return (
    <div className="flex h-full bg-background text-foreground">
      <SettingsNavSidebar
        groups={NAV_GROUPS}
        scrollRef={mainRef}
        header={
          <div className="flex items-center gap-2">
            <div className="grid size-7 place-items-center rounded-md bg-primary text-[var(--primary-foreground)]">
              <Settings2 className="size-4" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold">Settings</div>
              <div className="truncate text-[11px] text-muted-foreground">
                Cadencr v{APP_VERSION}
              </div>
            </div>
          </div>
        }
        footer={
          <div className="flex items-center justify-between gap-2">
            <span>Changes save automatically.</span>
            <button
              type="button"
              onClick={goBack}
              title="Back to workspace (Esc)"
              className="inline-flex items-center gap-1 rounded border border-border bg-card px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <ArrowLeft className="size-3" />
              Esc
            </button>
          </div>
        }
      />

      <main ref={mainRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[820px] space-y-6 px-4 py-6 md:px-10 md:py-8">
          <header className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <Breadcrumbs />
              <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
              <p className="text-sm text-muted-foreground">
                Configure how Cadencr looks, runs, and orchestrates agents.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={goBack}
              className="shrink-0 gap-1.5"
              title="Back to workspace (Esc)"
            >
              <ArrowLeft className="size-3.5" />
              Back
            </Button>
          </header>

          <AppearanceSection />
          <EditorSection />
          <InterfaceSection />
          <NotificationsSection />
          <RuntimeSection />
          <GitSection />
          <ProvidersSection />
          <AboutSection />

          <div className="h-12" />
        </div>
      </main>
    </div>
  );
}

function Breadcrumbs(): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span>Cadencr</span>
      <ChevronRight className="size-3" />
      <span>Settings</span>
    </div>
  );
}

/* ─── Appearance ─────────────────────────────────────────────────────── */

function AppearanceSection(): React.JSX.Element {
  return (
    <SettingsSection id="appearance" title="Appearance" subtitle="Theme · Animations · Verbosity">
      <SettingsCard>
        <SettingsSubsection padded={false}>
          <ThemeSelector />
          <AnimationsToggle divided />
        </SettingsSubsection>
        <SettingsSubsection
          title="Agent output verbosity"
          description="Control how much of each agent turn stays expanded in the stream. Switching modes does not affect what the agent does — only how its output is rendered."
        >
          <AgentVerbositySettings />
        </SettingsSubsection>
      </SettingsCard>
    </SettingsSection>
  );
}

/* ─── Editor ─────────────────────────────────────────────────────────── */

function EditorSection(): React.JSX.Element {
  const vimMode = useDebouncedSetting("editor_vim_mode");
  const autoSave = useDebouncedSetting("editor_auto_save");
  const gitBlame = useDebouncedSetting("editor_git_blame");
  const maxTabs = useDebouncedSetting("editor_max_tabs");

  const isVimEnabled = (vimMode.value ?? "false") === "true";
  const isAutoSaveEnabled = (autoSave.value ?? "false") === "true";
  const isGitBlameEnabled = (gitBlame.value ?? "false") === "true";
  const maxTabsValue = maxTabs.value ?? "10";
  const isLimited = maxTabsValue !== "0";
  const maxTabsNum = isLimited ? parseInt(maxTabsValue, 10) || 10 : 10;

  const setMaxTabsNum = (n: number) => {
    const clamped = Math.max(1, Math.min(50, n));
    maxTabs.setValue(String(clamped));
  };

  return (
    <SettingsSection id="editor" title="Editor" subtitle="CodeMirror · File tree">
      <SettingsCard>
        <SettingsSubsection
          title="File tree icons"
          description="Controls the icon density of the editor's file tree. Affects every project."
        >
          <FileTreeIconSetSelector />
        </SettingsSubsection>
        <SettingsSubsection
          title="Language servers"
          description="Cmd-click and F12 jump-to-definition use these. Servers launch on demand the first time you open a matching file."
        >
          <LspServerList />
        </SettingsSubsection>
        <SettingsSubsection padded={false}>
          <SettingsSwitchRow
            icon={<Keyboard className="size-4" />}
            iconTint="cyan"
            label="Vim motions"
            description="Modal editing in the built-in code editor."
            checked={isVimEnabled}
            onCheckedChange={(checked) => vimMode.setValue(checked ? "true" : "false")}
          />
          <SettingsSwitchRow
            icon={<Save className="size-4" />}
            iconTint="green"
            label="Auto-save"
            description="Automatically save files after a short delay."
            checked={isAutoSaveEnabled}
            onCheckedChange={(checked) => autoSave.setValue(checked ? "true" : "false")}
            divided
          />
          <SettingsSwitchRow
            icon={<History className="size-4" />}
            iconTint="orange"
            label="Git blame"
            description="Show blame annotation on the current line."
            checked={isGitBlameEnabled}
            onCheckedChange={(checked) => gitBlame.setValue(checked ? "true" : "false")}
            divided
          />
          <SettingsRow
            divided
            align="start"
            icon={
              <IconTile tint="pink">
                <Files className="size-4" />
              </IconTile>
            }
            label="Max open tabs"
            description="Older tabs are closed once you exceed the cap. Disable to keep them all."
            control={
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setMaxTabsNum(maxTabsNum - 1)}
                  disabled={!isLimited}
                  className="grid size-7 place-items-center rounded-md border border-border bg-card text-sm transition-colors hover:bg-accent disabled:opacity-40"
                  aria-label="Decrease max tabs"
                >
                  −
                </button>
                <Input
                  type="number"
                  min={1}
                  max={50}
                  disabled={!isLimited}
                  value={maxTabsNum}
                  onChange={(e) => setMaxTabsNum(parseInt(e.target.value, 10) || 1)}
                  className="h-7 w-14 text-center disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={() => setMaxTabsNum(maxTabsNum + 1)}
                  disabled={!isLimited}
                  className="grid size-7 place-items-center rounded-md border border-border bg-card text-sm transition-colors hover:bg-accent disabled:opacity-40"
                  aria-label="Increase max tabs"
                >
                  +
                </button>
                <label
                  htmlFor="max-tabs-unlimited"
                  className="ml-2 flex cursor-pointer items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
                >
                  Unlimited
                  <Switch
                    id="max-tabs-unlimited"
                    size="sm"
                    checked={!isLimited}
                    onCheckedChange={(checked) => maxTabs.setValue(checked ? "0" : "10")}
                  />
                </label>
              </div>
            }
          />
        </SettingsSubsection>
      </SettingsCard>
    </SettingsSection>
  );
}

/* ─── Interface & Zoom ───────────────────────────────────────────────── */

function InterfaceSection(): React.JSX.Element {
  const { zoomLevel, zoomIn, zoomOut, resetZoom } = useZoom();
  // Desktop and mobile keep independent zoom levels, so this control only ever
  // shows (and edits) the option for the device type it's running on.
  const isMobile = useIsMobile();

  return (
    <SettingsSection id="interface" title="Interface & Zoom" subtitle="UI scaling for this device">
      <SettingsCard>
        <SettingsRow
          align="start"
          icon={
            <IconTile tint="cyan">
              <ZoomIn className="size-4" />
            </IconTile>
          }
          label="UI zoom"
          description={
            isMobile ? (
              "Scales the interface on this device only — separate from the desktop app's zoom."
            ) : (
              <>
                Affects sidebar, editor, terminal, and chrome together.
                <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <Kbd>⌘ +</Kbd>
                  <Kbd>⌘ −</Kbd>
                  <Kbd>⌘ 0</Kbd>
                  work everywhere.
                </span>
              </>
            )
          }
          control={
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="size-7 p-0" onClick={zoomOut}>
                −
              </Button>
              <span className="w-14 text-center text-sm tabular-nums">{zoomLevel}%</span>
              <Button variant="outline" size="sm" className="size-7 p-0" onClick={zoomIn}>
                +
              </Button>
              <Button variant="ghost" size="sm" onClick={resetZoom}>
                Reset
              </Button>
            </div>
          }
        />
      </SettingsCard>
    </SettingsSection>
  );
}

function Kbd({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <kbd className="inline-flex h-[20px] min-w-[20px] items-center justify-center rounded border border-b-2 border-border bg-card px-1.5 font-mono text-[10px] font-medium text-foreground">
      {children}
    </kbd>
  );
}

/* ─── Runtime & Models ───────────────────────────────────────────────── */

function RuntimeSection(): React.JSX.Element {
  return (
    <SettingsSection id="runtime" title="Runtime & Models" subtitle="Per-agent provider & model">
      <SettingsCard>
        <ModelSelector level="global" />
      </SettingsCard>
    </SettingsSection>
  );
}

/* ─── Git ────────────────────────────────────────────────────────────── */

function GitSection(): React.JSX.Element {
  return (
    <SettingsSection id="git" title="Git" subtitle="Header actions defaults">
      <SettingsCard
        padded
        title="Merge strategy"
        description={
          <>
            Default mode used by the{" "}
            <span className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">Merge</span> action
            in the feature top bar.
          </>
        }
      >
        <GitSettings />
      </SettingsCard>
    </SettingsSection>
  );
}

/* ─── Providers ──────────────────────────────────────────────────────── */

const PROVIDER_TABS: ProviderId[] = [
  PROVIDER_IDS.CLAUDE_CODE,
  PROVIDER_IDS.OPENCODE,
  PROVIDER_IDS.CODEX_CLI,
];

function ProvidersSection(): React.JSX.Element {
  return (
    <SettingsSection
      id="providers"
      title="CLI Providers"
      subtitle="Binaries · Profiles · Permission modes"
    >
      <SettingsCard padded={false}>
        <Tabs defaultValue={PROVIDER_IDS.CLAUDE_CODE}>
          <TabsList aria-label="Provider" className="px-2">
            {PROVIDER_TABS.map((id) => (
              <TabsTrigger key={id} value={id}>
                <ProviderIcon providerId={id} alt="" className="size-4 rounded-sm shrink-0" />
                <span>{getProviderMetadata(id)?.label ?? id}</span>
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value={PROVIDER_IDS.CLAUDE_CODE}>
            <ClaudeProviderPanel />
          </TabsContent>
          <TabsContent value={PROVIDER_IDS.OPENCODE}>
            <OpencodeProviderPanel />
          </TabsContent>
          <TabsContent value={PROVIDER_IDS.CODEX_CLI}>
            <CodexProviderPanel />
          </TabsContent>
        </Tabs>
      </SettingsCard>
    </SettingsSection>
  );
}

function ClaudeProviderPanel(): React.JSX.Element {
  return (
    <>
      <SettingsSubsection>
        <BinaryDiscoverySection
          discoveryKey="claude"
          description={
            <>
              Every <strong>claude</strong> install Cadencr found on disk. The selected one is what
              gets spawned. To override, set a path during onboarding.
            </>
          }
        />
      </SettingsSubsection>
      <SettingsSubsection>
        <ProfilesSection />
      </SettingsSubsection>
      <SettingsSubsection>
        <CustomModelsSection />
      </SettingsSubsection>
      <DangerousModeToggle
        variant="subsection"
        settingKey={CLAUDE_BYPASS_PERMISSIONS_SETTING_KEY}
        title="Allow BypassPermissions"
        description={
          <>
            Adds <strong>Bypass</strong> to Claude's permission-mode selector and cycle. Enabling
            this setting makes the mode available; Claude only skips checks when the current mode is
            Bypass.
          </>
        }
        warningTitle="Enable BypassPermissions for Claude?"
        warningBody={
          <>
            <p>
              BypassPermissions disables every safety check. Claude can edit, delete, and run any
              command without confirmation, including destructive ones.
            </p>
            <p>
              Only enable this in isolated environments (containers, VMs, dev containers) where
              Claude cannot damage your host system. You can always toggle it off later.
            </p>
          </>
        }
      />
    </>
  );
}

function OpencodeProviderPanel(): React.JSX.Element {
  return (
    <SettingsSubsection>
      <BinaryDiscoverySection
        discoveryKey="opencode"
        description={
          <>
            Every <strong>opencode</strong> install Cadencr found on disk. The selected one is
            spawned as <strong>opencode acp</strong>; override via onboarding or the{" "}
            <strong>opencode_cli_path</strong> workspace setting.
          </>
        }
      />
    </SettingsSubsection>
  );
}

function CodexProviderPanel(): React.JSX.Element {
  return (
    <>
      <SettingsSubsection>
        <BinaryDiscoverySection
          discoveryKey="codex"
          description={
            <>
              Every <strong>codex</strong> install Cadencr found on disk. The selected one is used
              to start <strong>codex app-server</strong>; override via onboarding or the{" "}
              <strong>codex_cli_path</strong> workspace setting.
            </>
          }
        />
      </SettingsSubsection>
      <SettingsSubsection>
        <CodexPermissionModeSetting />
      </SettingsSubsection>
    </>
  );
}

/* ─── About ──────────────────────────────────────────────────────────── */

function AboutSection(): React.JSX.Element {
  const isDesktop = desktopBridge.isElectron;
  const status = useUpdateStore((s) => s.status);
  const updateVersion = useUpdateStore((s) => s.version);
  const progress = useUpdateStore((s) => s.progress);
  const error = useUpdateStore((s) => s.error);
  const checkForUpdates = useUpdateStore((s) => s.checkForUpdates);
  const installUpdate = useUpdateStore((s) => s.installUpdate);
  const checking = status === "checking" || status === "downloading";

  return (
    <SettingsSection id="about" title="About" subtitle="Build · Diagnostics">
      <SettingsCard padded>
        <div className="flex items-center gap-4">
          <div className="grid size-12 shrink-0 place-items-center">
            <CadencrLogo className="size-12" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold">Cadencr Desktop</div>
            <div className="font-mono text-xs text-muted-foreground">v{APP_VERSION}</div>
          </div>
          {isDesktop && (
            <div className="flex items-center gap-2">
              {status === "downloaded" ? (
                <Button size="sm" onClick={() => void installUpdate()}>
                  Restart to install v{updateVersion ?? ""}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={checking}
                  onClick={() => void checkForUpdates()}
                >
                  {checking ? "Checking…" : "Check for updates"}
                </Button>
              )}
            </div>
          )}
        </div>
        {isDesktop && (
          <div role="status" aria-live="polite" className="mt-3 text-xs text-muted-foreground">
            {updateStatusMessage(status, { progress, version: updateVersion, error })}
          </div>
        )}
      </SettingsCard>
    </SettingsSection>
  );
}

function updateStatusMessage(
  status: UpdateStatus,
  detail: { progress: number; version: string | null; error: string | null },
): string {
  switch (status) {
    case "checking":
      return "Checking for updates…";
    case "downloading":
      return `Downloading update${detail.version ? ` v${detail.version}` : ""}… ${Math.round(detail.progress)}%`;
    case "downloaded":
      return `Update v${detail.version ?? ""} ready — restart to install.`;
    case "up-to-date":
      return "You're on the latest version.";
    case "available":
      return `Update v${detail.version ?? ""} available.`;
    case "error":
      return detail.error ? `Update check failed: ${detail.error}` : "Update check failed.";
    case "idle":
    default:
      return "";
  }
}
