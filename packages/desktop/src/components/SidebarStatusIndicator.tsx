import { memo } from "react";
import { SidebarPendingGatePopover } from "@/components/SidebarPendingGatePopover";
import type { LiveAgentStatus } from "@/stores/session-status-store";

/** Fixed leading slot: status stays legible even when provider branding is hidden. */
export const SidebarStatusIndicator = memo(function SidebarStatusIndicator({
  featureId,
  liveStatus,
  isActive,
  isUnread,
  onOpenConversation,
}: {
  featureId: number;
  liveStatus: LiveAgentStatus;
  isActive: boolean;
  isUnread: boolean;
  onOpenConversation: () => void;
}) {
  return (
    <span
      data-sidebar-status={liveStatus}
      className="inline-flex size-3.5 shrink-0 items-center justify-center"
    >
      {liveStatus === "question" ? (
        <SidebarPendingGatePopover
          featureId={featureId}
          allowAutoOpen={!isActive}
          onOpenConversation={onOpenConversation}
        />
      ) : liveStatus === "agent" ? (
        <span
          role="img"
          aria-label="Agent working"
          className="sidebar-status-dot sidebar-status-working"
        />
      ) : isUnread ? (
        <span
          role="img"
          aria-label="Unread agent messages"
          className="sidebar-status-dot sidebar-status-unread"
        />
      ) : (
        <span
          role="img"
          aria-label="Agent idle"
          className="size-1.5 rounded-full bg-muted-foreground/30"
        />
      )}
    </span>
  );
});
