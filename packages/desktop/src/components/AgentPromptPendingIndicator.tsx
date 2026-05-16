import { ShieldAlertIcon, ClipboardCheck, MessageCircleQuestionIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Kind = "permission" | "plan" | "question";

interface AgentPromptPendingIndicatorProps {
  kind: Kind;
  /** Optional contextual detail (e.g. tool name for permissions) */
  detail?: string;
}

interface KindStyle {
  icon: ReactNode;
  label: string;
  outerBorder: string;
  banner: string;
}

const STYLES: Record<Kind, KindStyle> = {
  permission: {
    icon: <ShieldAlertIcon className="size-3.5" />,
    label: "Permission request pending",
    outerBorder: "border-amber-500/30",
    banner: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  },
  plan: {
    icon: <ClipboardCheck className="size-3.5" />,
    label: "Plan approval pending",
    outerBorder: "border-primary/30",
    banner: "border-primary/30 bg-primary/10 text-primary",
  },
  question: {
    icon: <MessageCircleQuestionIcon className="size-3.5" />,
    label: "Question pending",
    outerBorder: "border-border",
    banner: "border-border bg-muted/40 text-muted-foreground",
  },
};

/**
 * Lightweight banner shown above the prompt bar while a special prompt
 * (permission, plan approval, or question) is debounced behind the user's
 * typing. It tells the user the prompt is queued without stealing focus or
 * shortcuts.
 */
export function AgentPromptPendingIndicator({ kind, detail }: AgentPromptPendingIndicatorProps) {
  const { icon, label, outerBorder, banner } = STYLES[kind];
  return (
    <div className={cn("border-t bg-card px-3 py-2", outerBorder)}>
      <div className={cn("flex items-center gap-2 rounded-md border px-3 py-2 text-xs", banner)}>
        {icon}
        <span className="font-medium">{label}</span>
        {detail && (
          <>
            <span className="text-muted-foreground">-</span>
            <code className="rounded bg-muted px-1 py-0.5 text-[11px] text-foreground">
              {detail}
            </code>
          </>
        )}
        <span className="ml-auto text-muted-foreground">Finish typing to review it</span>
      </div>
    </div>
  );
}
