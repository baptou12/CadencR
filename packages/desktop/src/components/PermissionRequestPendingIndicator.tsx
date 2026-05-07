import { ShieldAlertIcon } from "lucide-react";

interface PermissionRequestPendingIndicatorProps {
  toolName: string;
}

export function PermissionRequestPendingIndicator({
  toolName,
}: PermissionRequestPendingIndicatorProps) {
  return (
    <div className="border-t border-amber-500/30 bg-card px-3 py-2">
      <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
        <ShieldAlertIcon className="size-3.5" />
        <span className="font-medium">Permission request ready</span>
        <span className="text-muted-foreground">-</span>
        <code className="rounded bg-muted px-1 py-0.5 text-[11px] text-foreground">{toolName}</code>
        <span className="ml-auto text-muted-foreground">Finish typing to review it</span>
      </div>
    </div>
  );
}
