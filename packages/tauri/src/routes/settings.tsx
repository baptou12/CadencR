import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ModelSelector } from "../components/ModelSelector";
import { useZoom } from "@/hooks/useZoom";
import { useDebouncedSetting } from "@/hooks/useDebouncedSetting";
import {
  useGetWorkspaceSetting,
  useSetWorkspaceSetting,
  getGetWorkspaceSettingQueryKey,
} from "../api/generated";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 border-b border-border px-6 pt-6 pb-0">
        <h1 className="text-2xl font-bold mr-6 pb-2">Settings</h1>
      </div>

      <GeneralTab />
    </div>
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
          <h2 className="text-lg font-semibold">Model Configuration</h2>
          <p className="text-sm text-muted-foreground">Choose which Claude model to use for each agent type.</p>
        </div>
        <ModelSelector level="global" />
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Agent Autonomy</h2>
          <p className="text-sm text-muted-foreground">Controls how much automation the execute agent uses when building features.</p>
        </div>
        <AgentAutonomySelect />
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Parallel Execution</h2>
          <p className="text-sm text-muted-foreground">Run multiple agents in parallel within each execution step.</p>
        </div>
        <ParallelExecutionToggle />
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
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: getGetWorkspaceSettingQueryKey("parallel_execution") });
      toast.success("Settings saved");
    },
  });

  const isChecked = (parallel.data?.value ?? "true") === "true";

  return (
    <div className="flex items-center gap-2">
      <Switch
        id="parallel-execution"
        checked={isChecked}
        onCheckedChange={(checked) =>
          setParallel.mutate({ key: "parallel_execution", value: checked ? "true" : "false" })
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
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: getGetWorkspaceSettingQueryKey("agent_autonomy") });
      toast.success("Settings saved");
    },
  });

  const currentValue = autonomy.data?.value ?? "1";

  return (
    <select
      className="border rounded px-3 py-1.5 text-sm bg-background"
      value={currentValue}
      onChange={(e) => setAutonomy.mutate({ key: "agent_autonomy", value: e.target.value })}
    >
      <option value="1">Low — ask before commit</option>
      <option value="2">Medium — manual continue</option>
      <option value="3">High — full auto</option>
    </select>
  );
}

function ZoomControl() {
  const { zoomLevel, zoomIn, zoomOut, resetZoom } = useZoom();

  return (
    <div className="flex items-center gap-3">
      <Button variant="outline" size="sm" onClick={zoomOut}>−</Button>
      <span className="text-sm w-12 text-center tabular-nums">{zoomLevel}%</span>
      <Button variant="outline" size="sm" onClick={zoomIn}>+</Button>
      <Button variant="ghost" size="sm" onClick={resetZoom}>Reset</Button>
      <span className="text-xs text-muted-foreground ml-2">⌘+ / ⌘− / ⌘0</span>
    </div>
  );
}

function EditorSettings() {
  const vimMode = useDebouncedSetting("editor_vim_mode");
  const autoSave = useDebouncedSetting("editor_auto_save");
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
        <label htmlFor="editor-vim-mode" className="text-sm cursor-pointer">Vim mode</label>
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Switch
            id="editor-auto-save"
            checked={isAutoSaveEnabled}
            onCheckedChange={(checked) => autoSave.setValue(checked ? "true" : "false")}
          />
          <label htmlFor="editor-auto-save" className="text-sm cursor-pointer">Auto-save</label>
        </div>
        <p className="text-xs text-muted-foreground ml-9">Automatically save files after a short delay.</p>
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
