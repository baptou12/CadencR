import type { ReactElement } from "react";
import { SettingsIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FeatureStewardToggle } from "./FeatureStewardToggle";
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
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="size-7" title="Feature settings">
          <SettingsIcon className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[820px] max-w-[calc(100vw-2rem)]" align="end">
        <div className="flex flex-col gap-3">
          <ModelSelector level="feature" featureId={featureId} projectId={projectId} />
          <FeatureStewardToggle featureId={featureId} />
        </div>
      </PopoverContent>
    </Popover>
  );
}
