import { useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { DEFAULT_MODEL, phaseModelKey } from "@/shared/models";
import { Button } from "./ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "./ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useGetWorkflowDefinition,
  useGetFeatureSettings,
  getGetFeatureSettingsQueryKey,
  useSetFeatureSetting,
  useListModels,
} from "@/api/generated";

const INHERIT_VALUE = "__inherit__";

interface WorkflowModelSelectorProps {
  featureId: number;
  workflowDefinitionId: number;
}

export function WorkflowModelSelector({ featureId, workflowDefinitionId }: WorkflowModelSelectorProps) {
  const queryClient = useQueryClient();
  const { data: models = [] } = useListModels();
  const { data: definition, isLoading: isDefLoading } = useGetWorkflowDefinition(workflowDefinitionId);
  const { data: featureSettingsData, isLoading: isSettingsLoading } = useGetFeatureSettings(featureId);
  const [openFor, setOpenFor] = useState<string | null>(null);

  const settingsMap = featureSettingsData
    ? Object.fromEntries(featureSettingsData.map((s) => [s.key, s.value]))
    : {};

  const setFeatureSetting = useSetFeatureSetting({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getGetFeatureSettingsQueryKey(featureId) });
      toast.success("Settings saved");
    },
  });

  if (isDefLoading || isSettingsLoading) {
    return <div className="text-sm text-muted-foreground">Loading model settings...</div>;
  }

  const phases = definition?.phases
    ? [...definition.phases].sort((a, b) => a.order_index - b.order_index)
    : [];

  function getModelLabel(modelId: string): string {
    return models.find((m) => m.id === modelId)?.label ?? modelId;
  }

  function getEffectiveModel(phaseSlug: string): string {
    const phase = phases.find((p) => p.slug === phaseSlug);
    if (phase?.model_override) return phase.model_override;
    return DEFAULT_MODEL;
  }

  function getCurrentValue(phaseSlug: string): string {
    const val = settingsMap[phaseModelKey(phaseSlug)];
    return val && val !== "" ? val : INHERIT_VALUE;
  }

  function getDisplayLabel(phaseSlug: string): string {
    const current = getCurrentValue(phaseSlug);
    if (current === INHERIT_VALUE) {
      const effective = getEffectiveModel(phaseSlug);
      return `Inherit (${getModelLabel(effective)})`;
    }
    return getModelLabel(current);
  }

  function handleChange(phaseSlug: string, value: string) {
    const modelId = value === INHERIT_VALUE ? "" : value;
    setFeatureSetting.mutate({ featureId, key: phaseModelKey(phaseSlug), value: modelId });
    setOpenFor(null);
  }

  return (
    <div className="space-y-2">
      {phases.map((phase) => {
        const currentValue = getCurrentValue(phase.slug);
        const effectiveModel = getEffectiveModel(phase.slug);

        return (
          <div key={phase.id} className="flex items-center gap-3">
            <label className="flex w-24 shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
              {phase.name}
            </label>
            <Popover open={openFor === phase.slug} onOpenChange={(open) => setOpenFor(open ? phase.slug : null)}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  className="h-7 flex-1 justify-between px-2 text-xs font-normal"
                >
                  <span className="truncate">{getDisplayLabel(phase.slug)}</span>
                  <ChevronsUpDownIcon className="ml-1 size-3 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search models..." className="h-8 text-xs" />
                  <CommandList>
                    <CommandEmpty className="py-2 text-center text-xs">No model found.</CommandEmpty>
                    <CommandGroup>
                      <CommandItem
                        value={INHERIT_VALUE}
                        onSelect={() => handleChange(phase.slug, INHERIT_VALUE)}
                        className="text-xs"
                      >
                        <CheckIcon className={cn("mr-2 size-3", currentValue === INHERIT_VALUE ? "opacity-100" : "opacity-0")} />
                        Inherit ({getModelLabel(effectiveModel)})
                      </CommandItem>
                      {models.map((model) => (
                        <CommandItem
                          key={model.id}
                          value={model.id}
                          keywords={[model.label]}
                          onSelect={() => handleChange(phase.slug, model.id)}
                          className="text-xs"
                        >
                          <CheckIcon className={cn("mr-2 size-3", currentValue === model.id ? "opacity-100" : "opacity-0")} />
                          {model.label}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
        );
      })}
    </div>
  );
}
