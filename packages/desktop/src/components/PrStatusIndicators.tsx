import { GitPullRequestIcon } from "lucide-react";
import type { CiState, PrStatusSnapshot } from "@/api/generated";
import { ShortcutTooltip } from "@/components/ShortcutTooltip";
import { cn } from "@/lib/utils";

const CI_STYLE: Record<CiState, string> = {
  none: "bg-muted-foreground/50",
  running: "bg-[var(--acc-orange)] animate-pulse",
  passing: "bg-[var(--acc-green)]",
  failing: "bg-[var(--acc-red)]",
};

export type PrIndicatorTone = "blocked" | "danger" | "merged" | "neutral" | "ready";

const PR_ICON_STYLE: Record<PrIndicatorTone, string> = {
  blocked: "text-[var(--acc-orange)]",
  danger: "text-[var(--acc-red)]",
  merged: "text-[var(--acc-green)]",
  neutral: "text-muted-foreground",
  ready: "text-blue-400",
};

const PR_CHIP_SURFACE: Record<PrIndicatorTone, string> = {
  blocked: "border-[var(--acc-orange)]/40 bg-[var(--acc-orange)]/10",
  danger: "border-[var(--acc-red)]/40 bg-[var(--acc-red)]/10",
  merged: "border-[var(--acc-green)]/40 bg-[var(--acc-green)]/10",
  neutral: "border-border/70 bg-background/50",
  ready: "border-blue-400/40 bg-blue-400/10",
};

/** Semantic surface classes for PR state / review chips in the PR pane. */
export const PR_TONE_BADGE: Record<PrIndicatorTone, string> = {
  blocked: "border-[var(--acc-orange)]/40 bg-[var(--acc-orange)]/10 text-[var(--acc-orange)]",
  danger: "border-[var(--acc-red)]/40 bg-[var(--acc-red)]/10 text-[var(--acc-red)]",
  merged: "border-[var(--acc-green)]/40 bg-[var(--acc-green)]/10 text-[var(--acc-green)]",
  neutral: "border-border bg-muted/40 text-muted-foreground",
  ready: "border-blue-400/40 bg-blue-400/10 text-blue-400",
};

export function prIndicatorTone(snapshot: PrStatusSnapshot | undefined): PrIndicatorTone {
  const pr = snapshot?.pr;
  if (!pr) return "neutral";
  if (pr.state === "merged") return "merged";
  if (pr.state === "closed") return "neutral";
  if (
    pr.state === "draft" ||
    pr.review_state === "changes_requested" ||
    pr.review_state === "pending" ||
    snapshot?.ci?.state === "running"
  ) {
    return "blocked";
  }
  if (snapshot.error || snapshot.ci?.state === "failing") return "danger";
  return "ready";
}

export function prStatusLabel(snapshot: PrStatusSnapshot): string {
  const pr = snapshot.pr!;
  const details: string[] = [];
  if (pr.state === "merged") details.push("merged");
  else if (pr.state === "draft") details.push("draft");
  else if (pr.state === "closed") details.push("closed");

  if (pr.review_state === "approved") details.push("approved");
  else if (pr.review_state === "changes_requested") details.push("changes requested");
  else if (pr.review_state === "pending") details.push("review pending");

  if (snapshot.ci && snapshot.ci.state !== "none") {
    details.push(`checks ${snapshot.ci.state}`);
  } else if (details.length === 0) {
    details.push("no blockers reported");
  }
  return `${pr.pr_label} ${pr.number} · ${details.join(" · ")}`;
}

export function CiStatusDot({
  snapshot,
  className,
}: {
  snapshot: PrStatusSnapshot | undefined;
  className?: string;
}): React.JSX.Element | null {
  if (snapshot?.error) {
    return (
      <span
        className={cn(
          "size-1.5 rounded-full bg-[var(--acc-red)] ring-1 ring-background",
          className,
        )}
        aria-label={`Forge status error: ${snapshot.error}`}
        title={snapshot.error}
      />
    );
  }
  const state = snapshot?.ci?.state;
  if (!state || state === "none") return null;
  const label = `Checks ${state}`;
  return (
    <span
      className={cn("size-1.5 rounded-full ring-1 ring-background", CI_STYLE[state], className)}
      aria-label={label}
      title={label}
    />
  );
}

export function FeaturePrChip({
  snapshot,
}: {
  snapshot: PrStatusSnapshot | undefined;
}): React.JSX.Element | null {
  const pr = snapshot?.pr;
  if (!pr) return null;
  const label = prStatusLabel(snapshot);
  const tone = prIndicatorTone(snapshot);
  return (
    <ShortcutTooltip label={label} toRight className="shrink-0">
      <span
        className={cn(
          "inline-flex h-5 max-w-full shrink-0 items-center gap-1 rounded-md border px-1.5 font-mono text-[10.5px] font-medium leading-none tabular-nums",
          PR_CHIP_SURFACE[tone],
          PR_ICON_STYLE[tone],
        )}
        aria-label={label}
      >
        <GitPullRequestIcon className="size-3 shrink-0" aria-hidden />
        <span className="truncate">{pr.number}</span>
      </span>
    </ShortcutTooltip>
  );
}
