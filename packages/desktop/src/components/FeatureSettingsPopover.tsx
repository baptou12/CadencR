import type { ReactElement } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { BrainCircuitIcon, CpuIcon, SettingsIcon } from "lucide-react";
import {
  getGetFeatureSettingsQueryKey,
  useGetFeatureSettings,
  useSetFeatureSetting,
} from "@/api/generated";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ModelSelector } from "./ModelSelector";

interface FeatureSettingsPopoverProps {
  featureId: number;
  projectId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function FeatureSettingsPopover({
  featureId,
  projectId,
  open,
  onOpenChange,
}: FeatureSettingsPopoverProps): ReactElement {
  const queryClient = useQueryClient();
  const { data: featureSettingsData } = useGetFeatureSettings(featureId);
  const featureSettings = featureSettingsData
    ? Object.fromEntries(featureSettingsData.map((s) => [s.key, s.value]))
    : {};
  const setFeatureSetting = useSetFeatureSetting({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetFeatureSettingsQueryKey(featureId) });
        toast.success("Settings saved");
      },
    },
  });
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="size-7" title="Feature settings">
          <SettingsIcon className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[820px] max-w-[calc(100vw-2rem)]" align="end">
        <div className="space-y-4">
          <ModelSelector level="feature" featureId={featureId} projectId={projectId} />
          <AutonomySettings
            featureId={featureId}
            value={featureSettings.agent_autonomy ?? ""}
            mutate={setFeatureSetting.mutate}
          />
          <ParallelExecutionSettings
            featureId={featureId}
            enabled={
              (featureSettings.parallel_execution ?? "") === "true" ||
              featureSettings.parallel_execution == null
            }
            mutate={setFeatureSetting.mutate}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface SettingMutation {
  (variables: { id: number; data: { key: string; value: string } }): void;
}

function AutonomySettings({
  featureId,
  value,
  mutate,
}: {
  featureId: number;
  value: string;
  mutate: SettingMutation;
}): ReactElement {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <BrainCircuitIcon className="size-3.5 text-muted-foreground" />
        <span className="text-xs font-medium">Agent Autonomy</span>
      </div>
      <Select
        value={value}
        onValueChange={(nextValue) => {
          mutate({ id: featureId, data: { key: "agent_autonomy", value: nextValue } });
        }}
      >
        <SelectTrigger className="h-8 text-sm">
          <SelectValue placeholder="Inherit from project" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="1">Low — ask before commit</SelectItem>
          <SelectItem value="2">Medium — manual continue</SelectItem>
          <SelectItem value="3">High — full auto</SelectItem>
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        Controls how much the execute agent does automatically
      </p>
    </div>
  );
}

function ParallelExecutionSettings({
  featureId,
  enabled,
  mutate,
}: {
  featureId: number;
  enabled: boolean;
  mutate: SettingMutation;
}): ReactElement {
  return (
    <div className="flex items-center justify-between">
      <div className="space-y-0.5">
        <div className="flex items-center gap-1.5">
          <CpuIcon className="size-3.5 text-muted-foreground" />
          <span className="text-xs font-medium">Parallel Execution</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Run multiple agents in parallel within each step
        </p>
      </div>
      <Switch
        id="feature-parallel-execution"
        checked={enabled}
        onCheckedChange={(checked) => {
          mutate({
            id: featureId,
            data: { key: "parallel_execution", value: checked ? "true" : "false" },
          });
        }}
      />
    </div>
  );
}
