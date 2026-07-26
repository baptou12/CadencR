import { GitPullRequestIcon } from "lucide-react";
import type { PrStatusSnapshot, PrSummary } from "@/api/generated";
import { ShortcutTooltip } from "@/components/ShortcutTooltip";
import { cn } from "@/lib/utils";

export type PrIndicatorTone = "blocked" | "danger" | "merged" | "neutral" | "ready" | "unresolved";

const PR_ICON_STYLE: Record<PrIndicatorTone, string> = {
  blocked: "text-[var(--acc-orange)]",
  danger: "text-[var(--acc-red)]",
  merged: "text-[var(--acc-green)]",
  neutral: "text-muted-foreground",
  ready: "text-blue-400",
  unresolved: "text-[var(--acc-yellow)]",
};

const PR_CHIP_SURFACE: Record<PrIndicatorTone, string> = {
  blocked: "border-[var(--acc-orange)]/40 bg-[var(--acc-orange)]/10",
  danger: "border-[var(--acc-red)]/40 bg-[var(--acc-red)]/10",
  merged: "border-[var(--acc-green)]/40 bg-[var(--acc-green)]/10",
  neutral: "border-border/70 bg-background/50",
  ready: "border-blue-400/40 bg-blue-400/10",
  unresolved: "border-[var(--acc-yellow)]/40 bg-[var(--acc-yellow)]/10",
};

/** Semantic surface classes for PR state / review chips in the PR pane. */
export const PR_TONE_BADGE: Record<PrIndicatorTone, string> = {
  blocked: "border-[var(--acc-orange)]/40 bg-[var(--acc-orange)]/10 text-[var(--acc-orange)]",
  danger: "border-[var(--acc-red)]/40 bg-[var(--acc-red)]/10 text-[var(--acc-red)]",
  merged: "border-[var(--acc-green)]/40 bg-[var(--acc-green)]/10 text-[var(--acc-green)]",
  neutral: "border-border bg-muted/40 text-muted-foreground",
  ready: "border-blue-400/40 bg-blue-400/10 text-blue-400",
  unresolved: "border-[var(--acc-yellow)]/40 bg-[var(--acc-yellow)]/10 text-[var(--acc-yellow)]",
};

export function prIndicatorTone(snapshot: PrStatusSnapshot | undefined): PrIndicatorTone {
  const pr = snapshot?.pr;
  if (!pr) return "neutral";
  if (pr.state === "merged") return "merged";
  if (pr.state === "closed") return "neutral";
  // Red outranks orange: a failing check run is the one thing the user has to
  // act on, and "awaiting review" is the most common state to be in while it
  // fails. The sidebar has no second slot left to say it in.
  if (snapshot.error || snapshot.ci?.state === "failing") return "danger";
  // A draft is still being written, so unanswered feedback on it is expected
  // rather than a call to action.
  if (pr.state === "draft") return "blocked";
  // Yellow is the "the machines are happy, the humans are not" state: green
  // checks used to read as ready-to-merge blue even with reviewers still
  // waiting on replies, which is the one case where the chip actively misled.
  // `unresolved_threads` is undefined when the poller never looked — unknown,
  // not zero — so an absent count correctly falls through to the checks.
  if (snapshot.ci?.state === "passing" && (snapshot.unresolved_threads ?? 0) > 0) {
    return "unresolved";
  }
  if (
    pr.review_state === "changes_requested" ||
    pr.review_state === "pending" ||
    snapshot.ci?.state === "running"
  ) {
    return "blocked";
  }
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
  }
  const unresolved = snapshot.unresolved_threads ?? 0;
  if (unresolved > 0) {
    details.push(`${unresolved} unresolved ${unresolved === 1 ? "thread" : "threads"}`);
  }
  if (details.length === 0) details.push("no blockers reported");
  return `${pr.pr_label} #${pr.number} · ${details.join(" · ")}`;
}

/**
 * The sidebar row's forge slot. Normally the proposal chip; when a host lookup
 * failed before any proposal was found there is no chip to tint, so the error
 * still surfaces as a dot rather than disappearing.
 */
export function FeaturePrIndicator({
  snapshot,
}: {
  snapshot: PrStatusSnapshot | undefined;
}): React.JSX.Element | null {
  if (!snapshot?.pr) {
    if (!snapshot?.error) return null;
    return (
      <span
        className="size-1.5 shrink-0 rounded-full bg-[var(--acc-red)] ring-1 ring-background"
        aria-label={`Forge status error: ${snapshot.error}`}
        title={snapshot.error}
      />
    );
  }
  return <FeaturePrChip snapshot={snapshot} pr={snapshot.pr} />;
}

function FeaturePrChip({
  snapshot,
  pr,
}: {
  snapshot: PrStatusSnapshot;
  pr: PrSummary;
}): React.JSX.Element {
  const label = prStatusLabel(snapshot);
  const tone = prIndicatorTone(snapshot);
  const running = snapshot.ci?.state === "running";
  return (
    <ShortcutTooltip label={label} toRight className="shrink-0">
      <span
        className={cn(
          "inline-flex h-5 max-w-full shrink-0 items-center gap-1 rounded-md border px-1.5 font-mono text-[10.5px] font-medium leading-none tabular-nums",
          PR_CHIP_SURFACE[tone],
          PR_ICON_STYLE[tone],
          // A live check run is the one state worth a halo, and it breathes so
          // it reads as "still working". Settled verdicts stay flat.
          running && "pr-chip-checks-running",
        )}
        aria-label={label}
      >
        <GitPullRequestIcon className="size-3 shrink-0" aria-hidden />
        <span className="truncate">{pr.number}</span>
      </span>
    </ShortcutTooltip>
  );
}
