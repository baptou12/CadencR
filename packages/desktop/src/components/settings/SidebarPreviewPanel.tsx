import { useRef, type ReactElement } from "react";
import { SidebarConfigProvider } from "@/components/SidebarConfigProvider";
import { SampleReplayButton } from "@/components/SidebarSampleBanner";
import { SidebarSampleBlocks } from "@/components/SidebarSampleBlocks";
import {
  SampleScope,
  SidebarSampleProvider,
  useSidebarSamplePreview,
} from "@/components/SidebarSampleProvider";
import { SidebarSampleRail } from "@/components/SidebarSampleRail";
import { SidebarSampleTree } from "@/components/SidebarSampleTree";
import {
  useSidebarDisplayAttributes,
  useSidebarHighlightAttribute,
} from "@/hooks/useSidebarDisplayAttributes";

/**
 * The sidebar as the options below set it, filled with sample conversations
 * that hit every case: it follows each change live, and outlines what the
 * option under the pointer changes.
 */
export function SidebarPreviewPanel(): ReactElement {
  return (
    <SidebarConfigProvider>
      <SidebarSampleProvider enabled>
        <PreviewFrame />
      </SidebarSampleProvider>
    </SidebarConfigProvider>
  );
}

function PreviewFrame(): ReactElement {
  const frameRef = useRef<HTMLElement>(null);
  const displayAttributes = useSidebarDisplayAttributes();
  useSidebarHighlightAttribute(frameRef);
  const preview = useSidebarSamplePreview();
  return (
    <section
      ref={frameRef}
      aria-label="Sidebar preview"
      {...displayAttributes}
      className="glass-surface flex max-h-[min(36rem,calc(100vh-4rem))] flex-col overflow-hidden rounded-xl border border-border/60 bg-sidebar"
    >
      <div className="flex shrink-0 items-center gap-1 border-b border-border/60 py-1 pl-3 pr-1 text-[11px] text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">Preview · sample conversations</span>
        {preview && <SampleReplayButton onReplay={preview.replay} />}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <SampleScope>
          <SidebarSampleBlocks />
          {/* As the sidebar's Projects header sets it. */}
          <div className="px-2 pb-2 text-xs font-semibold uppercase text-muted-foreground">
            Projects
          </div>
          <div className="flex min-w-0 flex-col gap-0.5 px-1">
            <SidebarSampleTree />
          </div>
          <SidebarSampleRail />
        </SampleScope>
      </div>
    </section>
  );
}
