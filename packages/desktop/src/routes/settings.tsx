import { useEffect, useRef, useState, type ReactNode } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useHotkeys } from "react-hotkeys-hook";
import {
  ArrowLeft,
  Bell,
  BrainCircuit,
  ChevronRight,
  Code2,
  Files,
  GitFork,
  GitMerge,
  History,
  Info,
  Keyboard,
  MonitorCog,
  Palette,
  Plug,
  Save,
  Settings2,
  Sparkles,
  Workflow,
  ZoomIn,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ModelSelector } from "@/components/ModelSelector";
import { ProviderPicker, type ProviderPickerOption } from "@/components/settings/ProviderPicker";
import {
  CLAUDE_BYPASS_PERMISSIONS_SETTING_KEY,
  CODEX_FULL_ACCESS_SETTING_KEY,
} from "@/shared/permission-mode-settings";
import { BinaryDiscoverySection } from "@/components/settings/BinaryDiscoverySection";
import { CustomModelsSection } from "@/components/settings/CustomModelsSection";
import { DangerousModeToggle } from "@/components/settings/DangerousModeToggle";
import { ProfilesSection } from "@/components/settings/ProfilesSection";
import { GitSettings } from "@/components/settings/GitSettings";
import { NotificationsSection } from "@/components/settings/NotificationsSection";
import { ThemeSelector } from "@/components/settings/ThemeSelector";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { SettingsSwitchRow } from "@/components/settings/SettingsSwitchRow";
import { RadioCardGroup } from "@/components/settings/RadioCardGroup";
import { AutonomyRadio } from "@/components/settings/AutonomyRadio";
import {
  SettingsNavSidebar,
  type SettingsNavGroup,
} from "@/components/settings/SettingsNavSidebar";
import { IconTile } from "@/components/settings/IconTile";
import { useZoom } from "@/hooks/useZoom";
import { useDebouncedSetting } from "@/hooks/useDebouncedSetting";
import { PROVIDER_IDS, type ProviderId } from "@/lib/providers";
import { APP_VERSION } from "@/lib/app-version";
import { AGENT_AUTONOMY_KEY, parseAgentAutonomy } from "@/lib/agent-autonomy";
import {
  DEFAULT_LOADER_STYLE,
  LOADER_STYLE_DETAILS,
  LOADER_STYLE_KEY,
  parseLoaderStyle,
  type LoaderStyle,
} from "@/lib/loader-style";

const PARALLEL_EXECUTION_KEY = "parallel_execution";

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
      { id: "appearance", label: "Appearance", icon: <Palette className="size-4" /> },
      { id: "editor", label: "Editor", icon: <Code2 className="size-4" /> },
      { id: "interface", label: "Interface & Zoom", icon: <MonitorCog className="size-4" /> },
      { id: "notifications", label: "Notifications", icon: <Bell className="size-4" /> },
    ],
  },
  {
    label: "Agents",
    items: [
      { id: "runtime", label: "Runtime & Models", icon: <BrainCircuit className="size-4" /> },
      { id: "feature-workflow", label: "Feature Workflow", icon: <Workflow className="size-4" /> },
    ],
  },
  {
    label: "Source Control",
    items: [{ id: "git", label: "Git", icon: <GitMerge className="size-4" /> }],
  },
  {
    label: "Providers",
    items: [{ id: "providers", label: "CLI Providers", icon: <Plug className="size-4" /> }],
  },
  {
    label: "About",
    items: [{ id: "about", label: "About Cadencr", icon: <Info className="size-4" /> }],
  },
];

function SettingsPage() {
  const { section } = Route.useSearch();
  const navigate = useNavigate();
  const mainRef = useRef<HTMLElement | null>(null);

  const goBack = () => {
    void navigate({ to: "/" });
  };

  // Escape leaves the settings page. Allow it to fire from inside form
  // controls so users don't have to defocus first.
  useHotkeys(
    "escape",
    (e) => {
      e.preventDefault();
      goBack();
    },
    { enableOnFormTags: true, enableOnContentEditable: true },
  );

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
                Workspace · Cadencr v{APP_VERSION}
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
        <div className="mx-auto max-w-[820px] space-y-6 px-10 py-8">
          <header className="space-y-1">
            <Breadcrumbs />
            <h1 className="text-2xl font-semibold tracking-tight">Workspace settings</h1>
            <p className="text-sm text-muted-foreground">
              Configure how Cadencr looks, runs, and orchestrates agents across your workspace.
            </p>
          </header>

          <AppearanceSection />
          <EditorSection />
          <InterfaceSection />
          <NotificationsSection />
          <RuntimeSection />
          <FeatureWorkflowSection />
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
    <SettingsSection id="appearance" title="Appearance" subtitle="Theme · Loader style">
      <SettingsCard padded className="space-y-5">
        <ThemeSelector />
        <div className="border-t border-border" />
        <LoaderStyleControl />
      </SettingsCard>
    </SettingsSection>
  );
}

function LoaderStyleControl(): React.JSX.Element {
  const loaderStyle = useDebouncedSetting(LOADER_STYLE_KEY);
  const value = parseLoaderStyle(loaderStyle.value ?? DEFAULT_LOADER_STYLE);

  return (
    <div className="space-y-3">
      <div>
        <div className="text-sm font-medium">Loader style</div>
        <p className="text-xs text-muted-foreground">
          How Cadencr signals an agent is running while you wait.
        </p>
      </div>
      <RadioCardGroup<LoaderStyle>
        ariaLabel="Loader style"
        value={value}
        onChange={(next) => loaderStyle.setValue(next)}
        layout="grid"
        options={LOADER_STYLE_DETAILS.map((option) => ({
          value: option.value,
          label: option.label,
          description: option.description,
        }))}
      />
    </div>
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
    <SettingsSection id="editor" title="Editor" subtitle="CodeMirror">
      <SettingsCard>
        <SettingsSwitchRow
          icon={<Keyboard className="size-4" />}
          iconTint="cyan"
          label="Vim mode"
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
              <label className="ml-2 flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
                <input
                  type="checkbox"
                  checked={!isLimited}
                  onChange={(e) => maxTabs.setValue(e.target.checked ? "0" : "10")}
                  className="accent-primary"
                />
                Unlimited
              </label>
            </div>
          }
        />
      </SettingsCard>
    </SettingsSection>
  );
}

/* ─── Interface & Zoom ───────────────────────────────────────────────── */

function InterfaceSection(): React.JSX.Element {
  const { zoomLevel, zoomIn, zoomOut, resetZoom } = useZoom();

  return (
    <SettingsSection id="interface" title="Interface & Zoom" subtitle="Global UI scaling">
      <SettingsCard padded>
        <SettingsRow
          icon={
            <IconTile tint="cyan">
              <ZoomIn className="size-4" />
            </IconTile>
          }
          label="UI zoom"
          description="Affects sidebar, editor, terminal, and chrome together."
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
          className="!px-0 !py-0"
        />
        <div className="ml-11 mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
          <Kbd>⌘ +</Kbd>
          <Kbd>⌘ −</Kbd>
          <Kbd>⌘ 0</Kbd>
          <span>shortcuts work everywhere.</span>
        </div>
      </SettingsCard>
    </SettingsSection>
  );
}

function Kbd({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-b-2 border-border bg-[var(--input)] px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
      {children}
    </kbd>
  );
}

/* ─── Runtime & Models ───────────────────────────────────────────────── */

function RuntimeSection(): React.JSX.Element {
  return (
    <SettingsSection
      id="runtime"
      title="Runtime & Models"
      subtitle="Per-agent provider & model"
      description="Choose the runtime provider and model for each agent type."
    >
      <SettingsCard>
        <ModelSelector level="global" />
      </SettingsCard>
    </SettingsSection>
  );
}

/* ─── Feature Workflow (autonomy + parallel execution) ───────────────── */

function FeatureWorkflowSection(): React.JSX.Element {
  return (
    <SettingsSection
      id="feature-workflow"
      title="Feature Workflow"
      subtitle="Defaults for new features"
      description="How features get built — how much automation the execute agent uses, and whether steps fan out in parallel. You can override per feature from its settings popover."
    >
      <SettingsCard padded className="space-y-5">
        <AutonomyPicker />
        <div className="border-t border-border" />
        <ParallelExecutionRow />
      </SettingsCard>
    </SettingsSection>
  );
}

function AutonomyPicker(): React.JSX.Element {
  const autonomy = useDebouncedSetting(AGENT_AUTONOMY_KEY, 0);
  const value = parseAgentAutonomy(autonomy.value);

  return (
    <div className="space-y-2">
      <div>
        <div className="text-sm font-medium">Autonomy</div>
        <p className="text-xs text-muted-foreground">
          How much automation the execute agent uses while building.
        </p>
      </div>
      <AutonomyRadio value={value} onChange={autonomy.setValue} disabled={autonomy.isLoading} />
    </div>
  );
}

function ParallelExecutionRow(): React.JSX.Element {
  const parallel = useDebouncedSetting(PARALLEL_EXECUTION_KEY, 0);
  const isChecked = (parallel.value ?? "true") === "true";

  return (
    <SettingsSwitchRow
      icon={<GitFork className="size-4" />}
      iconTint="purple"
      label="Parallel agent execution"
      description="Run multiple agents in parallel within each execution step. Speeds up large features at the cost of more concurrent CLI processes."
      checked={isChecked}
      onCheckedChange={(checked) => parallel.setValue(checked ? "true" : "false")}
    />
  );
}

/* ─── Git ────────────────────────────────────────────────────────────── */

function GitSection(): React.JSX.Element {
  return (
    <SettingsSection id="git" title="Git" subtitle="Header actions defaults">
      <SettingsCard padded>
        <div className="space-y-3">
          <div>
            <div className="text-sm font-medium">Merge strategy</div>
            <p className="text-xs text-muted-foreground">
              Default mode used by the{" "}
              <span className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">Merge</span>{" "}
              action in the feature top bar.
            </p>
          </div>
          <GitSettings />
        </div>
      </SettingsCard>
    </SettingsSection>
  );
}

/* ─── Providers ──────────────────────────────────────────────────────── */

const PROVIDER_PICKER_OPTIONS: ProviderPickerOption[] = [
  { id: PROVIDER_IDS.CLAUDE_CODE },
  { id: PROVIDER_IDS.OPENCODE },
  { id: PROVIDER_IDS.CODEX_CLI },
];

function ProvidersSection(): React.JSX.Element {
  const [active, setActive] = useState<ProviderId>(PROVIDER_IDS.CLAUDE_CODE);

  return (
    <SettingsSection
      id="providers"
      title="CLI Providers"
      subtitle="Binaries · Profiles · Permission modes"
      description="Cadencr spawns each provider's CLI directly. Manage which install gets used, configure custom profiles, and opt into unsafe permission modes."
    >
      <ProviderPicker options={PROVIDER_PICKER_OPTIONS} activeId={active} onChange={setActive} />
      <div id={`provider-panel-${active}`} role="tabpanel" className="mt-3 space-y-4">
        {active === PROVIDER_IDS.CLAUDE_CODE && <ClaudeProviderPanel />}
        {active === PROVIDER_IDS.OPENCODE && <OpencodeProviderPanel />}
        {active === PROVIDER_IDS.CODEX_CLI && <CodexProviderPanel />}
      </div>
    </SettingsSection>
  );
}

function ClaudeProviderPanel(): React.JSX.Element {
  return (
    <>
      <SettingsCard padded>
        <BinaryDiscoverySection
          discoveryKey="claude"
          description={
            <>
              Every <strong>claude</strong> install Cadencr found on disk. The selected one is what
              gets spawned. To override, set a path during onboarding.
            </>
          }
        />
      </SettingsCard>
      <DangerousModeToggle
        settingKey={CLAUDE_BYPASS_PERMISSIONS_SETTING_KEY}
        title="Allow BypassPermissions"
        description={
          <>
            Adds <strong>Bypass</strong> to the permission-mode cycle in the agent prompt for Claude
            sessions. When active, Claude executes every tool call without prompting and skips all
            safety checks.
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
      <SettingsCard padded>
        <ProfilesSection />
      </SettingsCard>
      <SettingsCard padded>
        <CustomModelsSection />
      </SettingsCard>
    </>
  );
}

function OpencodeProviderPanel(): React.JSX.Element {
  return (
    <SettingsCard padded>
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
    </SettingsCard>
  );
}

function CodexProviderPanel(): React.JSX.Element {
  return (
    <>
      <SettingsCard padded>
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
      </SettingsCard>
      <DangerousModeToggle
        settingKey={CODEX_FULL_ACCESS_SETTING_KEY}
        title="Allow Full Access"
        description={
          <>
            Adds <strong>Full Access</strong> to the permission-mode cycle in the agent prompt for
            Codex sessions. Maps to Codex's <strong>danger-full-access</strong> sandbox plus{" "}
            <strong>--ask-for-approval never</strong>: Codex runs every command, can write anywhere,
            and can make network requests without prompting.
          </>
        }
        warningTitle="Enable Full Access for Codex?"
        warningBody={
          <>
            <p>
              Full Access removes the workspace-write sandbox and disables every approval prompt.
              Codex can modify files outside the project, reach the network freely, and execute
              arbitrary commands.
            </p>
            <p>
              Only enable this in isolated environments (containers, VMs, throwaway branches). You
              can always toggle it off later.
            </p>
          </>
        }
      />
    </>
  );
}

/* ─── About ──────────────────────────────────────────────────────────── */

function AboutSection(): React.JSX.Element {
  return (
    <SettingsSection id="about" title="About" subtitle="Build · Diagnostics">
      <SettingsCard padded>
        <div className="flex items-center gap-4">
          <div className="grid size-12 place-items-center rounded-xl bg-primary text-[var(--primary-foreground)]">
            <Sparkles className="size-6" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold">Cadencr Desktop</div>
            <div className="font-mono text-xs text-muted-foreground">v{APP_VERSION}</div>
          </div>
        </div>
      </SettingsCard>
    </SettingsSection>
  );
}
