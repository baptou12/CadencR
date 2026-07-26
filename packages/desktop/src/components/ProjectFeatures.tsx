import { ArchiveFeatureDialog } from "@/components/ArchiveFeatureDialog";
import { ArchivedFeatureList } from "@/components/ArchivedFeatureList";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  ARCHIVED_FEATURE_STATUS,
  useProjectFeaturesController,
  type ProjectFeaturesController,
  type ProjectFeaturesProps,
} from "@/components/ProjectFeaturesController";
import { WorktreeGroup } from "@/components/WorktreeGroup";
import { deleteFeatureDialogTitle } from "@/lib/feature-archive-decision";

export function ProjectFeatures(props: ProjectFeaturesProps) {
  const controller = useProjectFeaturesController(props);
  return (
    <div className="flex flex-col gap-0.5">
      {controller.worktreeGroups.map((group) => (
        <WorktreeGroup
          key={group.key}
          label={group.label}
          features={group.features}
          renderFeature={controller.renderSubtree}
        />
      ))}
      {controller.flatActiveFeatures.map(controller.renderSubtree)}
      <ProjectFeatureDialogs projectId={props.projectId} controller={controller} />
      <ArchivedFeatureList
        features={controller.archivedFeatures}
        expanded={controller.showArchived}
        onToggle={() => controller.setShowArchived((value) => !value)}
        renderFeature={controller.renderFeature}
      />
    </div>
  );
}

function ProjectFeatureDialogs({
  projectId,
  controller,
}: {
  projectId: number;
  controller: ProjectFeaturesController;
}) {
  const { confirmation } = controller;
  return (
    <>
      <ArchiveFeatureDialog
        open={controller.confirmFeatureId != null && confirmation.action === "archive"}
        feature={confirmation.feature}
        projectId={projectId}
        hasLiveWorktree={confirmation.cleanup.hasLiveWorktree}
        hasResidualWorktreeDirectory={confirmation.cleanup.hasResidualWorktreeDirectory}
        showWorktreeRemoval={confirmation.cleanup.showWorktreeRemoval}
        showBranchRemoval={confirmation.cleanup.showBranchRemoval}
        onOpenChange={(open) => {
          if (!open) controller.setConfirmFeatureId(null);
        }}
        onArchive={(featureId) => {
          controller.actions.updateStatus(featureId, ARCHIVED_FEATURE_STATUS);
        }}
      />
      <ConfirmDialog
        open={controller.confirmFeatureId != null && confirmation.action === "delete"}
        onOpenChange={(open) => {
          if (!open) controller.setConfirmFeatureId(null);
        }}
        title={deleteFeatureDialogTitle(confirmation.feature)}
        description="This cannot be undone."
        confirmText="Delete"
        variant="destructive"
        onConfirm={() => {
          if (controller.confirmFeatureId == null) return;
          controller.actions.deleteFeature(controller.confirmFeatureId);
        }}
      />
    </>
  );
}
