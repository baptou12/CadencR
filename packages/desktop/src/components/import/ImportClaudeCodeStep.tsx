import { memo, useMemo, useState } from "react";
import { toast } from "sonner";
import { Search } from "lucide-react";
import {
  useListClaudeCodeConversations,
  useStartClaudeCodeImport,
  type ImportConversationSummary,
} from "@/api/generated";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { apiErrorMessage } from "@/lib/api-errors";

interface ImportClaudeCodeStepProps {
  projectId: number;
  onBack: () => void;
  onStarted: (jobId: string) => void;
}

/**
 * Lists Claude Code conversations found on disk for the active project's
 * path. The user filters by title, ticks rows, and clicks Import. Already
 * imported sessions render as checked + disabled.
 */
function ImportClaudeCodeStepInner({ projectId, onBack, onStarted }: ImportClaudeCodeStepProps) {
  const { data, isLoading, isError, error, refetch } = useListClaudeCodeConversations(projectId);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const conversations: ImportConversationSummary[] = data?.conversations ?? [];

  /**
   * One pass over the data: filter by query, collect the visible selectable
   * ids, count what's checked, and derive the tri-state for "select all".
   * Radix's Checkbox treats the string "indeterminate" specially.
   */
  const { filtered, visibleSelectableIds, selectedCount, selectAllState } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? conversations.filter((c) => c.title.toLowerCase().includes(q))
      : conversations;
    const visibleSelectableIds: string[] = [];
    let visibleSelectedCount = 0;
    for (const c of filtered) {
      if (c.already_imported) continue;
      visibleSelectableIds.push(c.source_session_id);
      if (selected[c.source_session_id]) visibleSelectedCount += 1;
    }
    const selectedCount = Object.values(selected).filter(Boolean).length;
    const selectAllState: boolean | "indeterminate" =
      visibleSelectableIds.length > 0 && visibleSelectedCount === visibleSelectableIds.length
        ? true
        : visibleSelectedCount > 0
          ? "indeterminate"
          : false;
    return { filtered, visibleSelectableIds, selectedCount, selectAllState };
  }, [conversations, query, selected]);

  const startMutation = useStartClaudeCodeImport({
    mutation: {
      onSuccess: (resp) => onStarted(resp.job_id),
      onError: (err) => toast.error(apiErrorMessage(err, "Failed to start import")),
    },
  });

  const toggle = (id: string) => {
    setSelected((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  /**
   * Toggle every visible selectable row. If anything is selected, the first
   * click clears them (matches the indeterminate-state mental model); a
   * second click selects all.
   */
  const toggleAllVisible = () => {
    setSelected((prev) => {
      const next = { ...prev };
      if (selectAllState === true) {
        for (const id of visibleSelectableIds) next[id] = false;
      } else {
        for (const id of visibleSelectableIds) next[id] = true;
      }
      return next;
    });
  };

  const handleImport = () => {
    const ids = Object.entries(selected)
      .filter(([, on]) => on)
      .map(([id]) => id);
    if (ids.length === 0) return;
    startMutation.mutate({ id: projectId, data: { session_ids: ids } });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="relative shrink-0">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search conversations by title…"
          className="h-8 pl-8 text-sm"
        />
      </div>

      <label
        className={`flex shrink-0 items-center gap-2 px-1 text-[11px] text-muted-foreground ${
          visibleSelectableIds.length === 0 ? "cursor-not-allowed opacity-50" : "cursor-pointer"
        }`}
      >
        <Checkbox
          checked={selectAllState}
          disabled={visibleSelectableIds.length === 0}
          onCheckedChange={toggleAllVisible}
          aria-label="Select all visible conversations"
        />
        <span>
          {selectAllState === true ? "Unselect all" : "Select all"}
          {query.trim() ? " matching" : ""}
          {visibleSelectableIds.length > 0 ? ` (${visibleSelectableIds.length})` : ""}
        </span>
      </label>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border">
        {isLoading && <ListSkeleton />}
        {!isLoading && isError && (
          <EmptyState
            title="Couldn't load conversations"
            description={apiErrorMessage(error, "Unknown error")}
            actionLabel="Retry"
            onAction={() => {
              void refetch();
            }}
          />
        )}
        {!isLoading && !isError && filtered.length === 0 && (
          <EmptyState
            title={
              conversations.length === 0
                ? "No Claude Code conversations found"
                : "No matching conversations"
            }
            description={
              conversations.length === 0
                ? "Looked under ~/.claude/projects/ for this project's path. Run Claude Code in this project's folder first."
                : "Try a different search term."
            }
          />
        )}
        {!isLoading && !isError && filtered.length > 0 && (
          <ul className="divide-y divide-border">
            {filtered.map((c) => (
              <ConversationRow
                key={c.source_session_id}
                conversation={c}
                checked={c.already_imported || !!selected[c.source_session_id]}
                disabled={c.already_imported}
                onToggle={() => toggle(c.source_session_id)}
              />
            ))}
          </ul>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-between gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          Back
        </Button>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">{selectedCount} selected</span>
          <Button
            type="button"
            size="sm"
            onClick={handleImport}
            disabled={selectedCount === 0 || startMutation.isPending}
          >
            {startMutation.isPending ? "Starting…" : `Import ${selectedCount}`}
          </Button>
        </div>
      </div>
    </div>
  );
}

interface ConversationRowProps {
  conversation: ImportConversationSummary;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}

function ConversationRow({ conversation, checked, disabled, onToggle }: ConversationRowProps) {
  return (
    <li>
      <label
        className={`flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-accent/40 ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
      >
        <Checkbox checked={checked} disabled={disabled} onCheckedChange={onToggle} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{conversation.title}</div>
          <div className="text-[11px] text-muted-foreground">
            {conversation.message_count} messages
            {conversation.modified_at ? ` · ${formatDate(conversation.modified_at)}` : ""}
            {conversation.already_imported ? " · already imported" : ""}
          </div>
        </div>
      </label>
    </li>
  );
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-2 p-3">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

interface EmptyStateProps {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

function EmptyState({ title, description, actionLabel, onAction }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 px-4 py-10 text-center">
      <div className="text-sm font-medium">{title}</div>
      <p className="text-[11px] text-muted-foreground">{description}</p>
      {actionLabel && onAction && (
        <Button type="button" variant="secondary" size="sm" className="mt-2" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export const ImportClaudeCodeStep = memo(ImportClaudeCodeStepInner);
