import type { ReactElement } from "react";
import { CheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { NextActionKind } from "@/lib/next-actions";
import { acknowledgeForMe } from "@/stores/for-me-ack";

/**
 * The For me row's hover check: marks the entry done without opening the
 * conversation (the only way to clear it, besides a prompt, when For me
 * clears "When done"). A pending request has none: it stays until answered.
 */
export function SidebarForMeDoneAction({
  featureId,
  kind,
}: {
  featureId: number;
  kind: NextActionKind;
}): ReactElement | null {
  if (kind === "waiting") return null;
  return (
    <span className="sidebar-row-actions">
      <Button
        size="sm"
        variant="ghost"
        title="Mark done"
        data-for-me-done
        className="size-6 shrink-0 p-0 text-muted-foreground transition-none hover:text-foreground"
        onClick={(e) => {
          e.stopPropagation();
          acknowledgeForMe(featureId);
        }}
      >
        <CheckIcon className="size-3.5" />
        <span className="sr-only">Mark done</span>
      </Button>
    </span>
  );
}
