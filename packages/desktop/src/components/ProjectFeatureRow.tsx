import type { ReactElement } from "react";
import {
  TrashIcon,
  ArchiveIcon,
  BotIcon,
  MessageCircleQuestionIcon,
  GitBranchIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useGetStats, type Feature } from "@/api/generated";
import { FeatureLabelChip } from "@/components/FeatureLabelChip";
import { FeatureLabelEditor } from "@/components/FeatureLabelEditor";
import { NumStat } from "@/components/NumStat";
import { STATUSES, STATUS_COLORS, type FeatureStatus } from "@/lib/feature-status";
import { useFeatureStatus } from "@/stores/session-status-store";

export type { FeatureStatus };

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
  isEditingLabel: boolean;
  labelDraft: string;
  labelSuggestions: readonly string[];
  isSavingLabel: boolean;
  onNavigate: (feature: Feature) => void;
  onStatusChange: (featureId: number, status: FeatureStatus) => void;
  onStartLabelEdit: (feature: Feature) => void;
  onLabelDraftChange: (value: string) => void;
  onSaveLabel: (featureId: number, override?: string) => void;
  onCancelLabelEdit: () => void;
  onArchiveOrDelete: (featureId: number) => void;
}

export function ProjectFeatureRow({
  feature,
  projectId,
  activeFeatureId,
  liveTitle,
  isAutoNaming,
  hasWorktree,
  hasLiveWorktree,
  isEditingLabel,
  labelDraft,
  labelSuggestions,
  isSavingLabel,
  onNavigate,
  onStatusChange,
  onStartLabelEdit,
  onLabelDraftChange,
  onSaveLabel,
  onCancelLabelEdit,
  onArchiveOrDelete,
}: ProjectFeatureRowProps): ReactElement {
  // Live status is the canonical 3-value enum: per-session entries pushed
  // by the backend, aggregated here per-feature. `useShallow` inside the
  // hook ensures this row only re-renders when its own feature's
  // (status, kind) actually changes.
  const { status: liveStatus } = useFeatureStatus(feature.id);
  // Use the same mode each route's Git tab uses so the query key (and cache)
  // is shared — ws-session rows read "worktree" stats, others "branch".
  const isActive = activeFeatureId === feature.id;
  const statsMode = feature.type === "ws-session" ? "worktree" : "branch";
  const { data: gitStats } = useGetStats(
    { feature_id: feature.id, mode: statsMode },
    {
      query: {
        // Limit fan-out: fetch only for live worktrees or the active row (which
        // the Git tab is already fetching). Other rows reuse the cache.
        enabled: hasLiveWorktree || isActive,
        refetchInterval: 5 * 60 * 1000,
        retry: false,
      },
    },
  );

  const hasStats = gitStats != null && (gitStats.insertions > 0 || gitStats.deletions > 0);
  const hasLabel = !!feature.label;
  const showMetaLine = isEditingLabel || hasLabel || hasStats || feature.type !== "ws-session";
  const startLabelEditAfterMenuClose = (): void => {
    window.setTimeout(() => onStartLabelEdit(feature), 0);
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="button"
          tabIndex={0}
          data-nav-item
          data-nav-type="feature"
          data-nav-id={String(feature.id)}
          data-nav-project-id={String(projectId)}
          className={`group/feature flex min-w-0 cursor-pointer items-center gap-1 rounded-md py-1.5 pl-3 pr-1.5 text-sm outline-none hover:bg-accent ${
            activeFeatureId === feature.id ? "bg-accent" : ""
          } ${feature.status === "archived" ? "opacity-50" : ""}`}
          onClick={(e) => {
            if (isActive || e.detail > 1) return;
            onNavigate(feature);
          }}
          onDoubleClick={(e) => {
            e.preventDefault();
            onStartLabelEdit(feature);
          }}
          onKeyDown={(e) => {
            if (shouldIgnoreFeatureRowKeyDown(e.target)) return;
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onNavigate(feature);
            }
          }}
        >
          {/* Live status icon driven by the per-session backend store. */}
          <div className="shrink-0 w-3.5">
            {liveStatus === "agent" && <BotIcon className="size-3.5 text-blue-500 animate-pulse" />}
            {liveStatus === "question" && (
              <MessageCircleQuestionIcon className="size-3.5 text-amber-400" />
            )}
          </div>

          {/* Name + optional metadata sub-line (stats + status badge) */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex min-w-0 items-center gap-1.5">
              {hasWorktree && (
                <GitBranchIcon
                  className="size-3 shrink-0 text-muted-foreground"
                  aria-label="Has worktree"
                />
              )}
              {isAutoNaming ? (
                <Skeleton className="h-4 w-32 min-w-0" />
              ) : (
                <span
                  className={`min-w-0 truncate ${
                    feature.status === "archived" ? "text-muted-foreground" : ""
                  }`}
                >
                  {liveTitle ?? feature.title}
                </span>
              )}
            </div>
            {showMetaLine && (
              <div className="flex items-center gap-2 text-[11px] leading-tight">
                {isEditingLabel ? (
                  <FeatureLabelEditor
                    value={labelDraft}
                    suggestions={labelSuggestions}
                    isSaving={isSavingLabel}
                    trigger={
                      feature.label ? (
                        <FeatureLabelChip label={feature.label} />
                      ) : (
                        <span className="rounded border border-dashed border-border px-1.5 py-0 font-mono text-[10.5px] leading-4 text-muted-foreground">
                          Set label
                        </span>
                      )
                    }
                    onChange={onLabelDraftChange}
                    onSave={(override) => onSaveLabel(feature.id, override)}
                    onCancel={onCancelLabelEdit}
                  />
                ) : (
                  <FeatureLabelChip label={feature.label} />
                )}
                {hasStats && (
                  <NumStat
                    additions={gitStats.insertions}
                    deletions={gitStats.deletions}
                    className="text-[11px] leading-tight"
                  />
                )}
                {feature.type !== "ws-session" && (
                  <Select
                    value={feature.status}
                    onValueChange={(v) => onStatusChange(feature.id, v as FeatureStatus)}
                  >
                    <SelectTrigger
                      size="sm"
                      className="h-auto border-none bg-transparent p-0 shadow-none [&_svg[class*='opacity']]:hidden"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Badge
                        variant="secondary"
                        className={`whitespace-nowrap rounded px-1.5 py-0 text-[10px] font-medium leading-none ${
                          STATUS_COLORS[feature.status as FeatureStatus] ?? ""
                        }`}
                      >
                        {feature.status}
                      </Badge>
                    </SelectTrigger>
                    <SelectContent>
                      {STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="size-6 shrink-0 p-0 text-muted-foreground hover:text-foreground opacity-0 group-hover/feature:opacity-100 transition-none"
              onClick={(e) => {
                e.stopPropagation();
                onArchiveOrDelete(feature.id);
              }}
            >
              {feature.status === "archived" ? (
                <TrashIcon className="size-3.5" />
              ) : (
                <ArchiveIcon className="size-3.5" />
              )}
              <span className="sr-only">
                {feature.status === "archived" ? "Delete" : "Archive"}
              </span>
            </Button>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent
        // "Set label" opens a popover that manages its own focus; letting
        // Radix restore focus to the trigger row would race with that and
        // can dismiss the editor immediately.
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <ContextMenuItem onSelect={() => onNavigate(feature)}>Open</ContextMenuItem>
        <ContextMenuItem onSelect={startLabelEditAfterMenuClose}>Set label</ContextMenuItem>
        {feature.type !== "ws-session" && (
          <>
            <ContextMenuSub>
              <ContextMenuSubTrigger>Set status</ContextMenuSubTrigger>
              <ContextMenuSubContent>
                {STATUSES.map((s) => (
                  <ContextMenuItem
                    key={s}
                    onSelect={() => onStatusChange(feature.id, s as FeatureStatus)}
                  >
                    {s}
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
          </>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={() => onArchiveOrDelete(feature.id)}>
          {feature.status === "archived" ? "Delete" : "Archive"}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function shouldIgnoreFeatureRowKeyDown(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest(ROW_KEYDOWN_IGNORED_SELECTOR) !== null;
}
