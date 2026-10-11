import type { ReactElement } from "react";
import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSidebarSamplePreview } from "@/components/SidebarSampleProvider";
import { useSidebarPreviewStore } from "@/stores/sidebar-preview-store";

/**
 * Says what the sidebar shows while the display options are open: sample
 * conversations covering every case, or the user's own. Part of the preview,
 * so using it keeps the display options open.
 */
export function SidebarSampleBanner(): ReactElement | null {
  const optionsOpen = useSidebarPreviewStore((state) => state.optionsOpen);
  const setShowMine = useSidebarPreviewStore((state) => state.setShowMine);
  const preview = useSidebarSamplePreview();
  if (!optionsOpen) return null;
  return (
    <div
      data-sidebar-sample
      className="mx-1 mb-2 flex shrink-0 flex-col gap-0.5 rounded-md border border-dashed border-border bg-background/40 px-2 pb-1 pt-1.5 text-[11px] text-muted-foreground"
    >
      <span>
        {preview ? "Sample conversations: every case your options change" : "Your conversations"}
      </span>
      <div className="-mx-1.5 flex items-center justify-between gap-1">
        {preview ? <SampleReplayButton onReplay={preview.replay} /> : <span />}
        <Button variant="ghost" size="xs" onClick={() => setShowMine(preview !== null)}>
          {preview ? "Show mine" : "Show samples"}
        </Button>
      </div>
    </div>
  );
}

/** Plays the samples' last changes again, so flashing and the gate popover can be seen. */
export function SampleReplayButton({ onReplay }: { onReplay: () => void }): ReactElement {
  return (
    <Button
      variant="ghost"
      size="xs"
      title="Play the samples' last changes again: rows flash, the newest request's popover opens"
      onClick={onReplay}
    >
      <Play />
      Replay
    </Button>
  );
}
