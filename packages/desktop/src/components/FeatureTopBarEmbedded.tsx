import type { ReactElement } from "react";
import { EmbeddedFeatureHeader } from "@/components/EmbeddedFeatureHeader";
import { WorktreeSetupSection } from "@/components/WorktreeSetupSection";
import type { WorktreeStatus } from "@/types/workflow";

interface EmbeddedSessionHeaderProps {
  featureId: number;
  projectId: number;
  projectName?: string;
  title: string;
  label?: string | null;
  lastActivityAt?: string | null;
  isPinned?: boolean;
  isPinPending?: boolean;
  onTogglePin?: () => void;
  onExclude?: () => void;
  className?: string;
  wsWorktreeStatus?: WorktreeStatus;
  wsWorktreeBranch?: string | null;
  wsWorktreeSetupOutput?: string[];
  wsWorktreeError?: string | null;
  onRetryWorktreeSetup?: () => void;
  hideWorktreeSetup?: boolean;
}

export function EmbeddedSessionHeader({
  featureId,
  projectId,
  projectName,
  title,
  label,
  lastActivityAt,
  isPinned,
  isPinPending,
  onTogglePin,
  onExclude,
  className,
  wsWorktreeStatus,
  wsWorktreeBranch,
  wsWorktreeSetupOutput,
  wsWorktreeError,
  onRetryWorktreeSetup,
  hideWorktreeSetup = false,
}: EmbeddedSessionHeaderProps): ReactElement {
  return (
    <>
      <EmbeddedFeatureHeader
        featureId={featureId}
        projectId={projectId}
        projectName={projectName}
        title={title}
        label={label}
        lastActivityAt={lastActivityAt}
        isPinned={isPinned}
        isPinPending={isPinPending}
        onTogglePin={onTogglePin}
        onExclude={onExclude}
        worktreeStatus={wsWorktreeStatus}
        worktreeBranch={wsWorktreeBranch}
        className={className}
      />
      {!hideWorktreeSetup && (
        <WorktreeSetupSection
          featureId={featureId}
          projectId={projectId}
          wsWorktreeStatus={wsWorktreeStatus}
          wsWorktreeBranch={wsWorktreeBranch}
          wsWorktreeSetupOutput={wsWorktreeSetupOutput}
          wsWorktreeError={wsWorktreeError}
          onRetrySetup={onRetryWorktreeSetup}
        />
      )}
    </>
  );
}
