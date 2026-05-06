import { Button } from "@/components/ui/button";
import { KbdShortcut } from "./KbdShortcut";
import type { SplitSendAction } from "./AgentPromptBar";

interface SplitSendActionsProps {
  actions: SplitSendAction[];
  disabled: boolean;
  onAction: (action: SplitSendAction) => void;
}

export function SplitSendActions({ actions, disabled, onAction }: SplitSendActionsProps) {
  return (
    <div className="flex flex-col gap-1.5 pt-2">
      {actions.map((action, i) => (
        <Button
          key={i}
          variant={action.variant ?? "default"}
          size="sm"
          onClick={() => onAction(action)}
          disabled={disabled}
        >
          {action.icon}
          {action.label}
          {action.kbdShortcut && <KbdShortcut keys={action.kbdShortcut} />}
        </Button>
      ))}
    </div>
  );
}
