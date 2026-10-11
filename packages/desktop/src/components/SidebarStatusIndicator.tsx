import { memo, type ReactElement } from "react";
import { Check } from "lucide-react";
import { SidebarPendingGatePopover } from "@/components/SidebarPendingGatePopover";
import type { Attention } from "@/lib/sidebar-attention";
import { useSidebarOption } from "@/stores/sidebar-config-store";

/**
 * Fixed leading slot: status stays legible even when provider branding is
 * hidden. A pending request always shows (and stays answerable from here),
 * whatever the status style: the sidebar never hides what is waiting on you.
 */
export const SidebarStatusIndicator = memo(function SidebarStatusIndicator({
  attention,
  isActive,
  onOpenConversation,
}: {
  attention: Attention;
  isActive: boolean;
  onOpenConversation: () => void;
}): ReactElement | null {
  const style = useSidebarOption("status");
  if (style === "hidden" && attention.state !== "waiting") return null;
  return (
    <span
      data-sidebar-status={attention.state}
      className="inline-flex size-3.5 shrink-0 items-center justify-center"
    >
      {attention.state === "waiting" ? (
        <SidebarPendingGatePopover
          featureId={attention.sourceFeatureId}
          allowAutoOpen={!isActive}
          onOpenConversation={onOpenConversation}
        />
      ) : style === "dot" ? (
        <StatusDot state={attention.state} />
      ) : (
        <StatusShape state={attention.state} />
      )}
    </span>
  );
});

type QuietState = Exclude<Attention["state"], "waiting">;

const STATUS_LABELS: Record<QuietState, { label: string; title?: string }> = {
  working: { label: "Agent working", title: "Agent working" },
  unread: { label: "Unread agent messages", title: "Agent finished · Unread messages" },
  idle: { label: "Agent idle" },
};

function StatusShape({ state }: { state: QuietState }): ReactElement {
  const { label, title } = STATUS_LABELS[state];
  if (state === "working") {
    return <span role="img" aria-label={label} title={title} className="sidebar-status-working" />;
  }
  if (state === "unread") {
    return (
      <span role="img" aria-label={label} title={title} className="sidebar-status-unread">
        <Check aria-hidden="true" className="size-3.5" strokeWidth={3} />
      </span>
    );
  }
  return (
    <span role="img" aria-label={label} className="size-1.5 rounded-full bg-muted-foreground/30" />
  );
}

const DOT_CLASS: Record<QuietState, string> = {
  working: "sidebar-status-dot-working size-2 bg-blue-500",
  unread: "size-2 bg-(--acc-green)",
  idle: "size-1.5 bg-muted-foreground/30",
};

/** Color-only variant for a quieter sidebar; working still pulses so it reads as live. */
function StatusDot({ state }: { state: QuietState }): ReactElement {
  const { label, title } = STATUS_LABELS[state];
  return (
    <span
      role="img"
      aria-label={label}
      title={title}
      className={`rounded-full ${DOT_CLASS[state]}`}
    />
  );
}
