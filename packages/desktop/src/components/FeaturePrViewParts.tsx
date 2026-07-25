import {
  AlertCircleIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  CircleDashedIcon,
  ExternalLinkIcon,
  GitPullRequestIcon,
  Loader2Icon,
  XCircleIcon,
} from "lucide-react";
import { useCallback, useState, type ReactElement } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { type CiCheck, type CiState, type PrStatusSnapshot } from "@/api/generated";
import { Markdown } from "@/components/Markdown";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { Skeleton } from "@/components/ui/skeleton";
import { openExternalUrl } from "@/lib/open-external";
import { cn } from "@/lib/utils";

const CI_STATE_LABEL: Record<CiState, string> = {
  none: "none",
  running: "running",
  passing: "passing",
  failing: "failing",
};

const CI_STATE_TEXT: Record<CiState, string> = {
  none: "text-muted-foreground",
  running: "text-[var(--acc-orange)]",
  passing: "text-[var(--acc-green)]",
  failing: "text-[var(--acc-red)]",
};

export function AuthorInitials({ name }: { name: string }): ReactElement {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?";
  return (
    <span className="grid size-5 shrink-0 place-items-center rounded-full bg-muted text-[10px] font-semibold text-foreground">
      {initials}
    </span>
  );
}

export function relativeTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return formatDistanceToNowStrict(date, { addSuffix: true });
}

export function PrViewLoading(): ReactElement {
  return (
    <div className="space-y-4 p-4" role="status" aria-label="Loading pull request">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2.5">
          <div className="flex items-center gap-1.5">
            <Skeleton className="h-5 w-14 rounded-md" />
            <Skeleton className="h-4 w-12" />
          </div>
          <Skeleton className="h-5 w-64 max-w-full" />
          <Skeleton className="h-3.5 w-48 max-w-full" />
        </div>
        <Skeleton className="h-8 w-16 shrink-0 rounded-md" />
      </div>
      <Skeleton className="h-10 w-full rounded-md" />
      <div className="space-y-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-28 w-full rounded-md" />
      </div>
      <span className="sr-only">
        <Loader2Icon className="inline size-3 animate-spin" aria-hidden /> Loading pull request…
      </span>
    </div>
  );
}

export function PrViewError({
  message,
  compact = false,
}: {
  message: string;
  compact?: boolean;
}): ReactElement {
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-2 border border-destructive/40 bg-destructive/10 text-sm text-destructive",
        compact ? "rounded-md px-3 py-2" : "m-4 rounded-md p-3",
      )}
    >
      <AlertCircleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p className="min-w-0 break-words leading-snug">{message}</p>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description: string;
  action?: ReactElement;
  icon?: ReactElement;
}): ReactElement {
  return (
    <div className="grid h-full place-items-center px-6 py-10 text-center">
      <div className="max-w-[18rem] space-y-3">
        <div className="mx-auto grid size-10 place-items-center rounded-md border border-border bg-card text-muted-foreground">
          {icon ?? <CircleDashedIcon className="size-5" aria-hidden />}
        </div>
        <div className="space-y-1">
          <h2 className="text-sm font-semibold text-balance text-foreground">{title}</h2>
          <p className="text-[12.5px] leading-relaxed text-pretty text-muted-foreground">
            {description}
          </p>
        </div>
        {action ? <div className="pt-1">{action}</div> : null}
      </div>
    </div>
  );
}

export function PrEmptyIcon(): ReactElement {
  return <GitPullRequestIcon className="size-5" aria-hidden />;
}

/**
 * `collapsedByScroll` folds the list while the pane is scrolled away from the
 * top, so the pinned header band stays compact. A manual toggle overrides that
 * for the current scroll state only — scrolling back to the top (or away again)
 * hands control back to the automatic behavior, which is what makes the
 * fold/unfold feel like part of the scroll rather than a setting you fought.
 */
export function ChecksPanel({
  status,
  collapsedByScroll = false,
}: {
  status: PrStatusSnapshot;
  collapsedByScroll?: boolean;
}): ReactElement {
  // Adjusting state during render is React's documented way to reset state when
  // a prop changes: every scroll-state flip drops the manual override, so the
  // automatic fold/unfold resumes instead of replaying an old click forever.
  const [lastScrollState, setLastScrollState] = useState(collapsedByScroll);
  const [override, setOverride] = useState<boolean | null>(null);
  if (lastScrollState !== collapsedByScroll) {
    setLastScrollState(collapsedByScroll);
    setOverride(null);
  }
  const checksOpen = override ?? !collapsedByScroll;
  const ciState = status.ci?.state ?? "none";
  const checkCount = status.ci?.checks.length ?? 0;
  const summary =
    ciState === "none"
      ? checkCount === 0
        ? "none reported"
        : `${checkCount}`
      : `${checkCount} ${CI_STATE_LABEL[ciState]}`;

  return (
    <section className="overflow-hidden rounded-md border border-border bg-card">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm font-medium transition-colors hover:bg-accent/40"
        aria-expanded={checksOpen}
        onClick={() => setOverride(!checksOpen)}
      >
        <span className="inline-flex min-w-0 items-center gap-2">
          <CiStateIcon state={ciState} />
          <span>Checks</span>
          <span className={cn("truncate text-xs font-normal", CI_STATE_TEXT[ciState])}>
            {summary}
          </span>
        </span>
        <ChevronDownIcon
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform duration-150",
            checksOpen && "rotate-180",
          )}
          aria-hidden
        />
      </button>
      <CollapsibleSection open={checksOpen}>
        <div className="space-y-0.5 border-t border-border p-1.5">
          {checkCount > 0 ? (
            status.ci!.checks.map((check) => <CiCheckRow key={check.name} check={check} />)
          ) : (
            <p className="px-2 py-2.5 text-[12px] text-muted-foreground">No checks reported.</p>
          )}
        </div>
      </CollapsibleSection>
    </section>
  );
}

export function PrDescription({ status }: { status: PrStatusSnapshot }): ReactElement {
  const pr = status.pr!;
  return (
    <section className="space-y-2">
      <h3 className="text-[12.5px] font-semibold tracking-tight text-foreground">Description</h3>
      {pr.body_markdown ? (
        <Markdown
          content={pr.body_markdown}
          cacheKey={`${pr.url}:description`}
          className="max-w-none overflow-x-auto rounded-md border border-border bg-card p-3 text-[13px] leading-relaxed"
        />
      ) : (
        <p className="rounded-md border border-dashed border-border px-3 py-3 text-[12.5px] text-muted-foreground">
          No description provided.
        </p>
      )}
    </section>
  );
}

function CiCheckRow({ check }: { check: CiCheck }): ReactElement {
  const [opening, setOpening] = useState(false);
  const handleOpen = useCallback(async (): Promise<void> => {
    if (!check.url) return;
    setOpening(true);
    await openExternalUrl(check.url, "Could not open check.");
    setOpening(false);
  }, [check.url]);
  const rowClass = "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px]";
  const content = (
    <>
      <CiStateIcon state={check.state} />
      <span className="min-w-0 flex-1 truncate" title={check.name}>
        {check.name}
      </span>
      <span className={cn("shrink-0 text-[11px] capitalize", CI_STATE_TEXT[check.state])}>
        {CI_STATE_LABEL[check.state]}
      </span>
    </>
  );
  if (!check.url) return <div className={rowClass}>{content}</div>;
  return (
    <button
      type="button"
      className={cn(rowClass, "transition-colors hover:bg-accent/60 disabled:opacity-60")}
      disabled={opening}
      onClick={() => void handleOpen()}
    >
      {content}
      {opening ? (
        <Loader2Icon className="size-3 shrink-0 animate-spin text-muted-foreground" aria-hidden />
      ) : (
        <ExternalLinkIcon className="size-3 shrink-0 text-muted-foreground" aria-hidden />
      )}
    </button>
  );
}

function CiStateIcon({ state }: { state: CiState }): ReactElement {
  if (state === "passing")
    return <CheckCircle2Icon className="size-3.5 shrink-0 text-[var(--acc-green)]" aria-hidden />;
  if (state === "failing")
    return <XCircleIcon className="size-3.5 shrink-0 text-[var(--acc-red)]" aria-hidden />;
  if (state === "running")
    return (
      <Loader2Icon
        className="size-3.5 shrink-0 animate-spin text-[var(--acc-orange)]"
        aria-hidden
      />
    );
  return <CircleDashedIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />;
}
