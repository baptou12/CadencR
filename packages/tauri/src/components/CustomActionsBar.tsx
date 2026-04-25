import { useState, type ReactElement } from "react";
import { PlusIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useListCustomActions, type CustomAction } from "@/api/generated";
import { CustomActionButton } from "./CustomActionButton";
import { CustomActionEditorDialog } from "./CustomActionEditorDialog";
import { CustomActionsOverflowDropdown } from "./CustomActionsOverflowDropdown";

interface CustomActionsBarProps {
  featureId: number;
  projectId: number;
}

/**
 * Renders the per-feature custom-action buttons in the header. Up to 3 actions
 * fit inline; beyond that the third slot becomes an overflow dropdown.
 *
 * Layout:
 *   [act1] [act2] [act3 OR overflow] [+ add]
 */
export function CustomActionsBar({ featureId, projectId }: CustomActionsBarProps): ReactElement {
  const { data: actions = [] } = useListCustomActions({
    project_id: projectId,
    feature_id: featureId,
  });
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorTarget, setEditorTarget] = useState<CustomAction | undefined>(undefined);

  function openCreate(): void {
    setEditorTarget(undefined);
    setEditorOpen(true);
  }

  function openEdit(action: CustomAction): void {
    setEditorTarget(action);
    setEditorOpen(true);
  }

  const inline = actions.length <= 3 ? actions : actions.slice(0, 2);
  const overflow = actions.length <= 3 ? [] : actions.slice(2);

  return (
    <>
      {inline.map((action) => (
        <CustomActionButton
          key={action.id}
          action={action}
          featureId={featureId}
          projectId={projectId}
          onEdit={openEdit}
        />
      ))}
      {overflow.length > 0 && (
        <CustomActionsOverflowDropdown
          actions={overflow}
          featureId={featureId}
          projectId={projectId}
          onEdit={openEdit}
        />
      )}
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        title="Add custom action"
        onClick={openCreate}
      >
        <PlusIcon className="size-4" />
      </Button>

      <CustomActionEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        projectId={projectId}
        featureId={featureId}
        action={editorTarget}
      />
    </>
  );
}
