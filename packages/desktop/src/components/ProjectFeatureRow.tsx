import { memo, useCallback, useRef, type ReactElement, type ReactNode } from "react";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu";
import type { Feature, FeatureWorktreeInfo } from "@/api/generated";
import { SidebarShortcutBadge } from "@/components/SidebarShortcutBadge";
import { ProjectFeatureContextMenu } from "@/components/ProjectFeatureContextMenu";
import {
  FeatureRowActions,
  FeatureRowMetaLine,
  FeatureRowStatusIcon,
  FeatureRowTitleLine,
} from "@/components/ProjectFeatureRowParts";
import { useNavShortcutHint } from "@/hooks/useNavShortcutHints";
import { useProjectFeatureRowState } from "@/hooks/useProjectFeatureRowState";

const ROW_KEYDOWN_IGNORED_SELECTOR = [
  "input",
  "textarea",
  "select",
  "button",
  '[contenteditable="true"]',
  '[role="textbox"]',
  '[role="combobox"]',
  "[data-ignore-feature-row-keydown]",
].join(", ");

interface ProjectFeatureRowProps {
  feature: Feature;
  projectId: number;
  activeFeatureId: number | null;
  liveTitle: string | undefined;
  isAutoNaming: boolean;
  /** True when the feature has a worktree recorded in feature settings (icon). */
  hasWorktree: boolean;
  /** True only when the worktree directory still exists on disk (stats query). */
  hasLiveWorktree: boolean;
  worktree: FeatureWorktreeInfo | undefined;
  shellCount: number;
  browserCount: number;
  isEditingLabel: boolean;
  labelDraft: string;
  labelSuggestions: readonly string[];
  isSavingLabel: boolean;
  onNavigate: (feature: Feature) => void;
  onStartLabelEdit: (feature: Feature) => void;
  onLabelDraftChange: (value: string) => void;
  onSaveLabel: (featureId: number, override?: string) => void;
  onCancelLabelEdit: () => void;
  onArchiveOrDelete: (featureId: number) => void;
  onUnarchive: (featureId: number) => void;
  onTogglePin: (featureId: number, pinned: boolean) => void;
  onCloseActivity: (featureId: number, shellCount: number, browserCount: number) => void;
  /** Expand/collapse twisty rendered by FeatureSubtree. */
  hierarchyControl?: ReactNode;
  /** Zero-based nesting depth; indentation stays inside the full-width row. */
  hierarchyDepth?: number;
}

const FEATURE_NESTING_INDENT_PX = 16;

/**
 * Memoized: rendered N times per project in the sidebar. A parent update
 * (label edit, project rename) must not re-render every row. The parent
 * passes stable callback refs and a stable `labelSuggestions` reference, so
 * default shallow-prop comparison is sufficient.
 */
export const ProjectFeatureRow = memo(function ProjectFeatureRow({
  feature,
  projectId,
  activeFeatureId,
  liveTitle,
  isAutoNaming,
  hasWorktree,
  hasLiveWorktree,
  worktree,
  shellCount,
  browserCount,
  isEditingLabel,
  labelDraft,
  labelSuggestions,
  isSavingLabel,
  onNavigate,
  onStartLabelEdit,
  onLabelDraftChange,
  onSaveLabel,
  onCancelLabelEdit,
  onArchiveOrDelete,
  onUnarchive,
  onTogglePin,
  onCloseActivity,
  hierarchyControl,
  hierarchyDepth = 0,
}: ProjectFeatureRowProps): ReactElement {
  const startLabelEditOnMenuCloseRef = useRef(false);
  const {
    liveStatus,
    isUnread,
    prStatus,
    gitStats,
    isActive,
    isArchived,
    isPinned,
    prefetchFeature,
  } = useProjectFeatureRowState(feature, projectId, activeFeatureId, hasLiveWorktree);
  const { navRef, badgeRef } = useNavShortcutHint<HTMLDivElement>();
  const hasActivity = shellCount > 0 || browserCount > 0;
  const markStartLabelEditAfterMenuClose = (): void => {
    startLabelEditOnMenuCloseRef.current = true;
  };

  const handleMenuCloseAutoFocus = (event: Event): void => {
    if (!startLabelEditOnMenuCloseRef.current) return;
    startLabelEditOnMenuCloseRef.current = false;
    event.preventDefault();
    onStartLabelEdit(feature);
  };

  const handleOpenConversation = useCallback((): void => {
    onNavigate(feature);
  }, [feature, onNavigate]);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={navRef}
          role="button"
          tabIndex={0}
          data-nav-item
          data-nav-type="feature"
          data-nav-id={String(feature.id)}
          data-nav-project-id={String(projectId)}
          data-feature-depth={hierarchyDepth}
          className={`group/feature relative flex min-w-0 cursor-pointer items-center gap-0.5 rounded-md py-1.5 pl-3 pr-1.5 text-sm outline-none transition-colors hover:bg-sidebar-accent ${
            isActive ? "bg-sidebar-accent" : ""
          } ${isArchived ? "opacity-50" : ""}`}
          onClick={(e) => {
            if (isActive || e.detail > 1) return;
            onNavigate(feature);
          }}
          onMouseEnter={prefetchFeature}
          onFocus={prefetchFeature}
          onKeyDown={(e) => {
            if (shouldIgnoreFeatureRowKeyDown(e.target)) return;
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onNavigate(feature);
            }
          }}
        >
          <SidebarShortcutBadge ref={badgeRef} />
          <div
            data-feature-hierarchy-gutter
            className="flex h-3 w-2 shrink-0 items-center justify-center"
            style={{ marginInlineStart: hierarchyDepth * FEATURE_NESTING_INDENT_PX }}
          >
            {hierarchyControl}
          </div>

          <FeatureRowStatusIcon
            featureId={feature.id}
            liveStatus={liveStatus}
            isActive={isActive}
            isUnread={isUnread}
            onOpenConversation={handleOpenConversation}
          />

          {/* Name + optional metadata sub-line (stats). The check-run signal
              rides the PR chip's glow on the second line — it used to be a dot
              anchored here, which overlapped that chip. */}
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <FeatureRowTitleLine
              feature={feature}
              liveTitle={liveTitle}
              isAutoNaming={isAutoNaming}
              isArchived={isArchived}
              hasWorktree={hasWorktree}
            />
            <FeatureRowMetaLine
              feature={feature}
              prStatus={prStatus}
              gitStats={gitStats}
              shellCount={shellCount}
              browserCount={browserCount}
              isEditingLabel={isEditingLabel}
              labelDraft={labelDraft}
              labelSuggestions={labelSuggestions}
              isSavingLabel={isSavingLabel}
              onLabelDraftChange={onLabelDraftChange}
              onSaveLabel={onSaveLabel}
              onCancelLabelEdit={onCancelLabelEdit}
            />
          </div>

          <FeatureRowActions
            featureId={feature.id}
            isArchived={isArchived}
            isPinned={isPinned}
            onTogglePin={onTogglePin}
            onArchiveOrDelete={onArchiveOrDelete}
          />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent
        // Open the label editor after the menu fully closes. Opening directly
        // from onSelect races with Radix's context-menu focus/pointer teardown.
        onCloseAutoFocus={handleMenuCloseAutoFocus}
      >
        <ProjectFeatureContextMenu
          feature={feature}
          liveTitle={liveTitle}
          worktree={worktree}
          pullRequest={prStatus?.pr}
          isArchived={isArchived}
          isPinned={isPinned}
          hasActivity={hasActivity}
          shellCount={shellCount}
          browserCount={browserCount}
          onNavigate={onNavigate}
          onTogglePin={onTogglePin}
          onStartLabelEditAfterMenuClose={markStartLabelEditAfterMenuClose}
          onCloseActivity={onCloseActivity}
          onUnarchive={onUnarchive}
          onArchiveOrDelete={onArchiveOrDelete}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
});

export function shouldIgnoreFeatureRowKeyDown(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest(ROW_KEYDOWN_IGNORED_SELECTOR) !== null;
}
