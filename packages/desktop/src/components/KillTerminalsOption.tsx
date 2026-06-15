import type { ReactElement } from "react";
import { SquareTerminalIcon } from "lucide-react";
import { CleanupOption } from "@/components/CleanupOption";

interface KillTerminalsOptionProps {
  count: number;
  checked: boolean;
  onToggle: () => void;
}

/** Cleanup-dialog option to kill the feature's running shells (shortcut `T`). */
export function KillTerminalsOption(props: KillTerminalsOptionProps): ReactElement {
  return (
    <CleanupOption
      checked={props.checked}
      icon={<SquareTerminalIcon className="size-4" />}
      label="Kill terminals"
      shortcut="T"
      description={`Stop the ${props.count} running ${
        props.count === 1 ? "shell" : "shells"
      } in this session.`}
      onCheckedChange={props.onToggle}
    />
  );
}
