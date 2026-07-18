import { useEffect, useState } from "react";
import {
  useMostRecentPendingFeatureId,
  useFeaturePendingRequestId,
} from "@/stores/pending-gate-popover-selectors";
import { usePendingGatePopoverHoverStore } from "@/stores/pending-gate-popover-hover-store";

interface UsePendingGatePopoverOpenResult {
  open: boolean;
  setOpen: (open: boolean) => void;
  setHovered: (featureId: number | null) => void;
  hoveredFeatureId: number | null;
}

/**
 * Open/close rules for sidebar pending-gate popovers:
 * - most-recent pending feature auto-opens (and reopens on a new request id)
 * - older popovers close when another agent becomes most-recent, unless hovered
 */
export function usePendingGatePopoverOpen(featureId: number): UsePendingGatePopoverOpenResult {
  const mostRecentFeatureId = useMostRecentPendingFeatureId();
  const pendingRequestId = useFeaturePendingRequestId(featureId);
  const hoveredFeatureId = usePendingGatePopoverHoverStore((s) => s.hoveredFeatureId);
  const setHovered = usePendingGatePopoverHoverStore((s) => s.setHovered);

  const isMostRecent = mostRecentFeatureId === featureId;
  const isHovered = hoveredFeatureId === featureId;
  const [open, setOpen] = useState(isMostRecent);

  useEffect(() => {
    if (isMostRecent) setOpen(true);
  }, [featureId, isMostRecent, pendingRequestId]);

  useEffect(() => {
    if (!isMostRecent && !isHovered) setOpen(false);
  }, [isHovered, isMostRecent]);

  return { open, setOpen, setHovered, hoveredFeatureId };
}
