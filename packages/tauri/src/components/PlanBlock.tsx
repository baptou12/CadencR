import { cn } from "@/lib/utils";
import { ClipboardCheck, CircleCheckIcon, CircleXIcon } from "lucide-react";
import { Markdown } from "@/components/Markdown";
import { parseToolArgsObject, stringArg } from "@/lib/tool-args";

export function PlanBlock({
  args,
  approvalStatus,
}: {
  args?: string;
  approvalStatus?: "approved" | "rejected";
}) {
  const plan = stringArg(parseToolArgsObject(args), "plan");

  if (!plan) return null;

  return (
    <div className="my-2 rounded-md border border-primary/30 bg-primary/5">
      <div className="flex items-center gap-2 border-b border-primary/30 px-3 py-1.5 text-xs">
        <ClipboardCheck className="size-3 text-primary" />
        <span className="font-medium text-primary">Plan</span>
      </div>
      <div className="px-3 py-2">
        <Markdown content={plan} />
      </div>
      {approvalStatus && (
        <div
          className={cn(
            "flex items-center gap-1.5 border-t px-3 py-1.5 text-xs font-medium",
            approvalStatus === "approved"
              ? "border-[var(--acc-green)]/40 text-[var(--acc-green)]"
              : "border-destructive/40 text-destructive",
          )}
        >
          {approvalStatus === "approved" ? (
            <>
              <CircleCheckIcon className="size-3" /> Approved
            </>
          ) : (
            <>
              <CircleXIcon className="size-3" /> Rejected
            </>
          )}
        </div>
      )}
    </div>
  );
}
