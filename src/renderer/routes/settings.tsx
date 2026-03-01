import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { ModelSelector } from "../components/ModelSelector";
import { trpc } from "../trpc";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

function ParallelExecutionCheckbox() {
  const parallel = trpc.workspace.get.useQuery({ key: "parallel_execution" });
  const utils = trpc.useContext();
  const setParallel = trpc.workspace.set.useMutation({
    onSuccess: () => {
      utils.workspace.get.invalidate({ key: "parallel_execution" });
    },
  });

  const isChecked = (parallel.data ?? "true") === "true";

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
  const autonomy = trpc.workspace.get.useQuery({ key: "agent_autonomy" });
  const utils = trpc.useContext();
  const setAutonomy = trpc.workspace.set.useMutation({
    onSuccess: () => {
      utils.workspace.get.invalidate({ key: "agent_autonomy" });
    },
  });

  const currentValue = autonomy.data ?? "1";

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

function SettingsPage() {
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");

  const settingsList = trpc.workspace.list.useQuery();
  const setSetting = trpc.workspace.set.useMutation({
    onSuccess: () => {
      settingsList.refetch();
      setKey("");
      setValue("");
    },
  });

  return (
    <div className="p-6 space-y-8">
      <h1 className="text-2xl font-bold">Settings</h1>

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
          <h2 className="text-lg font-semibold">Custom Settings</h2>
          <p className="text-sm text-muted-foreground">
            Add or update raw key-value settings.
          </p>
        </div>
        <div className="flex gap-2">
          <input
            className="border rounded px-3 py-1.5 text-sm"
            placeholder="Key"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <input
            className="border rounded px-3 py-1.5 text-sm"
            placeholder="Value"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <button
            className="bg-primary text-primary-foreground px-4 py-1.5 rounded text-sm"
            onClick={() => {
              if (key && value) {
                setSetting.mutate({ key, value });
              }
            }}
          >
            Save
          </button>
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-medium">Stored Settings</h3>
          {settingsList.data?.length === 0 && (
            <p className="text-muted-foreground text-sm">
              No settings stored yet.
            </p>
          )}
          {settingsList.data?.map((item) => (
            <div key={item.key} className="flex gap-2 text-sm">
              <span className="font-mono font-medium">{item.key}</span>
              <span className="text-muted-foreground">=</span>
              <span>{item.value}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
