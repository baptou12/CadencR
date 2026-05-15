import { useCallback, useState, type ReactElement } from "react";
import ContentSearchDialog from "@/components/editor/ContentSearchDialog";
import { useGlobalShortcutById } from "@/hooks/useShortcut";
import { activateFeatureTab } from "@/stores/feature-layout-store";

interface FeatureContentSearchShortcutProps {
  featureId: number;
  projectId: number;
  enabled?: boolean;
  layoutFeatureId?: number;
}

export function FeatureContentSearchShortcut({
  featureId,
  projectId,
  enabled = true,
  layoutFeatureId = featureId,
}: FeatureContentSearchShortcutProps): ReactElement | null {
  const [open, setOpen] = useState(false);

  const activateEditorTab = useCallback((): void => {
    activateFeatureTab(layoutFeatureId, "editor");
  }, [layoutFeatureId]);

  useGlobalShortcutById(
    "content-search",
    (event: KeyboardEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      setOpen(true);
    },
    { enabled },
  );

  return open ? (
    <ContentSearchDialog
      projectId={projectId}
      featureId={featureId}
      open={open}
      onOpenChange={setOpen}
      onResultOpen={activateEditorTab}
    />
  ) : null;
}
