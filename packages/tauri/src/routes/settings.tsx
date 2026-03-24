import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ModelSelector } from "../components/ModelSelector";
import { useZoom } from "@/hooks/useZoom";
import {
  useGetWorkspaceSetting,
  useSetWorkspaceSetting,
  getGetWorkspaceSettingQueryKey,
} from "../api/generated";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

function ParallelExecutionCheckbox() {
  const parallel = useGetWorkspaceSetting("parallel_execution");
  const queryClient = useQueryClient();
  const setParallel = useSetWorkspaceSetting({
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: getGetWorkspaceSettingQueryKey("parallel_execution") });
    },
  });

  const isChecked = (parallel.data?.value ?? "true") === "true";

  return (
    <div className="flex items-center gap-2">
      <Checkbox
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
    },
  });

  const currentValue = autonomy.data?.value ?? "1";

  return (
    <select
      className="border rounded px-3 py-1.5 text-sm bg-background"
      value={currentValue}
      onChange={(e) =>
        setAutonomy.mutate({ key: "agent_autonomy", value: e.target.value })
      }
    >
      <option value="1">Low — ask before commit</option>
      <option value="2">Medium — manual continue</option>
      <option value="3">High — full auto</option>
    </select>
  );
}

function LanguageInput() {
  const language = useGetWorkspaceSetting("language");
  const queryClient = useQueryClient();
  const setLanguage = useSetWorkspaceSetting({
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: getGetWorkspaceSettingQueryKey("language") });
    },
  });

  const [draft, setDraft] = useState(language.data?.value ?? "");
  const committed = language.data?.value ?? "";

  // Sync draft when server data loads
  if (language.isSuccess && draft === "" && committed !== "") {
    setDraft(committed);
  }

  return (
    <div className="flex items-center gap-2">
      <input
        className="border rounded px-3 py-1.5 text-sm bg-background w-64"
        placeholder="English (default)"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const trimmed = draft.trim();
          if (trimmed !== committed) {
            if (trimmed) {
              setLanguage.mutate({ key: "language", value: trimmed });
            } else {
              setLanguage.mutate({ key: "language", value: "" });
            }
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
    </div>
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

function SettingsPage() {
  return (
    <div className="p-6 space-y-8">
      <h1 className="text-2xl font-bold">Settings</h1>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Zoom</h2>
          <p className="text-sm text-muted-foreground">
            Adjust the global UI zoom level.
          </p>
        </div>
        <ZoomControl />
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Model Configuration</h2>
          <p className="text-sm text-muted-foreground">
            Choose which Claude model to use for each agent type.
          </p>
        </div>
        <ModelSelector level="global" />
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Agent Autonomy</h2>
          <p className="text-sm text-muted-foreground">
            Controls how much automation the execute agent uses when building
            features.
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
        <ParallelExecutionCheckbox />
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Language</h2>
          <p className="text-sm text-muted-foreground">
            Set the language Claude uses when responding. Leave blank for English.
          </p>
        </div>
        <LanguageInput />
      </section>

    </div>
  );
}
