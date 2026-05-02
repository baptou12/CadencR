import type { ReactNode } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ModelSelector } from "../components/ModelSelector";
import { ProvidersTab } from "../components/settings/ProvidersTab";
import { ThemeSelector } from "../components/settings/ThemeSelector";
import { useZoom } from "@/hooks/useZoom";
import { useDebouncedSetting } from "@/hooks/useDebouncedSetting";
import {
  DEFAULT_LOADER_STYLE,
  LOADER_STYLE_DETAILS,
  LOADER_STYLE_KEY,
  parseLoaderStyle,
} from "@/lib/loader-style";
import {
  useGetWorkspaceSetting,
  useSetWorkspaceSetting,
  getGetWorkspaceSettingQueryKey,
} from "../api/generated";

const SETTINGS_TABS = ["general", "providers"] as const;
type SettingsTab = (typeof SETTINGS_TABS)[number];

function parseTab(value: unknown): SettingsTab {
  return SETTINGS_TABS.includes(value as SettingsTab) ? (value as SettingsTab) : "general";
}

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
  validateSearch: (search: Record<string, unknown>): { tab?: SettingsTab } => {
    if (search.tab && SETTINGS_TABS.includes(search.tab as SettingsTab)) {
      return { tab: search.tab as SettingsTab };
    }
    return {};
  },
});

function SettingsPage() {
  const { tab } = Route.useSearch();
  const navigate = useNavigate();
  const activeTab = parseTab(tab);

  const setTab = (next: SettingsTab) => {
    void navigate({
      to: "/settings",
      search: next === "general" ? {} : { tab: next },
      replace: true,
    });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 border-b border-border px-6 pt-6">
        <h1 className="text-2xl font-bold mr-6 pb-2">Settings</h1>
        <SettingsTabButton active={activeTab === "general"} onClick={() => setTab("general")}>
          General
        </SettingsTabButton>
        <SettingsTabButton active={activeTab === "providers"} onClick={() => setTab("providers")}>
          Providers
        </SettingsTabButton>
      </div>

      {activeTab === "providers" ? <ProvidersTab /> : <GeneralTab />}
    </div>
  );
}

function SettingsTabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={[
        "px-3 pb-2 text-sm font-medium -mb-px border-b-2 transition-colors",
        active
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function GeneralTab() {
  return (
    <div className="p-6 space-y-8 overflow-y-auto h-full">
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Zoom</h2>
          <p className="text-sm text-muted-foreground">Adjust the global UI zoom level.</p>
        </div>
        <ZoomControl />
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Agent Runtime</h2>
          <p className="text-sm text-muted-foreground">
            Choose the runtime provider and model for each agent type.
          </p>
        </div>
        <ModelSelector level="global" />
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Agent Autonomy</h2>
          <p className="text-sm text-muted-foreground">
            Controls how much automation the execute agent uses when building features.
          </p>
        </div>
        <AgentAutonomySelect />
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Parallel Execution</h2>
          <p className="text-sm text-muted-foreground">
            Run multiple agents in parallel within each execution step.
          </p>
        </div>
        <ParallelExecutionToggle />
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Loader Style</h2>
          <p className="text-sm text-muted-foreground">
            Choose between the default square loader and a discreet animated usage glow.
          </p>
        </div>
        <LoaderStyleControl />
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Appearance</h2>
          <p className="text-sm text-muted-foreground">
            Pick a theme. Affects the whole UI — sidebar, editor, terminal, and chrome.
          </p>
        </div>
        <ThemeSelector />
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Editor</h2>
          <p className="text-sm text-muted-foreground">Configure the built-in code editor.</p>
        </div>
        <EditorSettings />
      </section>
    </div>
  );
}

function ParallelExecutionToggle() {
  const parallel = useGetWorkspaceSetting("parallel_execution");
  const queryClient = useQueryClient();
  const setParallel = useSetWorkspaceSetting({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: getGetWorkspaceSettingQueryKey("parallel_execution"),
        });
        toast.success("Settings saved");
      },
    },
  });

  const isChecked = (parallel.data?.value ?? "true") === "true";

  return (
    <div className="flex items-center gap-2">
      <Switch
        id="parallel-execution"
        checked={isChecked}
        onCheckedChange={(checked) =>
          setParallel.mutate({
            key: "parallel_execution",
            data: { value: checked ? "true" : "false" },
          })
        }
      />
      <label htmlFor="parallel-execution" className="text-sm cursor-pointer">
        Enable parallel agent execution
      </label>
    </div>
  );
}

function AgentAutonomySelect() {
  const autonomy = useGetWorkspaceSetting("agent_autonomy");
  const queryClient = useQueryClient();
  const setAutonomy = useSetWorkspaceSetting({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: getGetWorkspaceSettingQueryKey("agent_autonomy"),
        });
        toast.success("Settings saved");
      },
    },
  });

  const currentValue = autonomy.data?.value ?? "1";

  return (
    <select
      className="border rounded px-3 py-1.5 text-sm bg-background"
      value={currentValue}
      onChange={(e) =>
        setAutonomy.mutate({ key: "agent_autonomy", data: { value: e.target.value } })
      }
    >
      <option value="1">Low — ask before commit</option>
      <option value="2">Medium — manual continue</option>
      <option value="3">High — full auto</option>
    </select>
  );
}

function LoaderStyleControl() {
  const loaderStyle = useDebouncedSetting(LOADER_STYLE_KEY);
  const value = parseLoaderStyle(loaderStyle.value ?? DEFAULT_LOADER_STYLE);

  return (
    <div className="space-y-2" role="radiogroup" aria-label="Loader style">
      {LOADER_STYLE_DETAILS.map((option) => {
        const isSelected = value === option.value;

        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isSelected}
            onClick={() => loaderStyle.setValue(option.value)}
            className={[
              "flex w-full items-start justify-between gap-4 rounded-lg border px-4 py-3 text-left transition-colors",
              isSelected
                ? "border-primary/60 bg-primary/8"
                : "border-border bg-background hover:bg-muted/40",
            ].join(" ")}
          >
            <div className="space-y-1">
              <div className="text-sm font-medium">{option.label}</div>
              <div className="text-sm text-muted-foreground">{option.description}</div>
            </div>
            <div
              className={[
                "mt-1 size-3 shrink-0 rounded-full border transition-colors",
                isSelected
                  ? "border-primary bg-primary"
                  : "border-muted-foreground/40 bg-transparent",
              ].join(" ")}
            />
          </button>
        );
      })}
    </div>
  );
}

function ZoomControl() {
  const { zoomLevel, zoomIn, zoomOut, resetZoom } = useZoom();

  return (
    <div className="flex items-center gap-3">
      <Button variant="outline" size="sm" onClick={zoomOut}>
        −
      </Button>
      <span className="text-sm w-12 text-center tabular-nums">{zoomLevel}%</span>
      <Button variant="outline" size="sm" onClick={zoomIn}>
        +
      </Button>
      <Button variant="ghost" size="sm" onClick={resetZoom}>
        Reset
      </Button>
      <span className="text-xs text-muted-foreground ml-2">⌘+ / ⌘− / ⌘0</span>
    </div>
  );
}

function EditorSettings() {
  const vimMode = useDebouncedSetting("editor_vim_mode");
  const autoSave = useDebouncedSetting("editor_auto_save");
  const gitBlame = useDebouncedSetting("editor_git_blame");
  const maxTabs = useDebouncedSetting("editor_max_tabs");

  const isVimEnabled = (vimMode.value ?? "false") === "true";
  const isAutoSaveEnabled = (autoSave.value ?? "false") === "true";
  const maxTabsValue = maxTabs.value ?? "10";
  const isUnlimited = maxTabsValue === "0";
  const maxTabsNum = isUnlimited ? 10 : parseInt(maxTabsValue, 10);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Switch
          id="editor-vim-mode"
          checked={isVimEnabled}
          onCheckedChange={(checked) => vimMode.setValue(checked ? "true" : "false")}
        />
        <label htmlFor="editor-vim-mode" className="text-sm cursor-pointer">
          Vim mode
        </label>
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Switch
            id="editor-auto-save"
            checked={isAutoSaveEnabled}
            onCheckedChange={(checked) => autoSave.setValue(checked ? "true" : "false")}
          />
          <label htmlFor="editor-auto-save" className="text-sm cursor-pointer">
            Auto-save
          </label>
        </div>
        <p className="text-xs text-muted-foreground ml-9">
          Automatically save files after a short delay.
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Switch
            id="editor-git-blame"
            checked={(gitBlame.value ?? "false") === "true"}
            onCheckedChange={(checked) => gitBlame.setValue(checked ? "true" : "false")}
          />
          <label htmlFor="editor-git-blame" className="text-sm cursor-pointer">
            Git blame
          </label>
        </div>
        <p className="text-xs text-muted-foreground ml-9">
          Show blame annotation on the current line.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium">Max open tabs</label>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min={1}
            max={50}
            disabled={isUnlimited}
            value={isUnlimited ? 10 : maxTabsNum}
            onChange={(e) => {
              const n = Math.max(1, Math.min(50, parseInt(e.target.value, 10) || 1));
              maxTabs.setValue(String(n));
            }}
            className="border rounded px-3 py-1.5 text-sm bg-background w-24 disabled:opacity-50"
          />
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={isUnlimited}
              onChange={(e) => maxTabs.setValue(e.target.checked ? "0" : "10")}
              className="rounded"
            />
            Unlimited
          </label>
        </div>
      </div>
    </div>
  );
}
