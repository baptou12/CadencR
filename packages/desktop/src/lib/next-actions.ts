import type { Feature, PrStatusSnapshot } from "@/api/generated";
import { prIndicatorTone } from "@/components/PrStatusIndicators";
import type { AttentionEntry } from "@/lib/attention-index";
import type { SidebarConfig } from "@/lib/sidebar-config";

/**
 * What the user should do next about a conversation, most urgent first:
 * - waiting: answer the agent's pending request (it stays stopped until then);
 * - failed: look at the error that stopped the turn;
 * - fix_ci / address_review: the pull request is blocked on its checks or its review;
 * - review: the agent finished, nobody has read the result yet;
 * - merge: the pull request is approved and its checks are green.
 */
export type NextActionKind =
  | "waiting"
  | "failed"
  | "fix_ci"
  | "address_review"
  | "review"
  | "merge";

export interface NextActionEntry {
  featureId: number;
  kind: NextActionKind;
}

export interface ResolvedNextAction {
  feature: Feature;
  kind: NextActionKind;
}

/** Tiers in the order the "For me" block lists them; within a tier, oldest first. */
const TIER: Record<NextActionKind, number> = {
  waiting: 0,
  failed: 1,
  fix_ci: 2,
  address_review: 2,
  review: 3,
  merge: 4,
};

/**
 * What a pull request asks of the user, if anything. "Merge" takes the row's
 * PR chip verdict (`prIndicatorTone`), so the two never disagree: no merge
 * while threads are unresolved or checks still run. A snapshot the forge
 * failed to refresh asks nothing: its state may be stale.
 */
export function prActionKind(snapshot: PrStatusSnapshot | undefined): NextActionKind | null {
  const pr = snapshot?.pr;
  if (!pr || snapshot.error || (pr.state !== "open" && pr.state !== "draft")) return null;
  if (snapshot.ci?.state === "failing") return "fix_ci";
  if (pr.review_state === "changes_requested") return "address_review";
  if (pr.review_state === "approved" && prIndicatorTone(snapshot) === "ready") return "merge";
  return null;
}

function actionKey(kind: NextActionKind, pr: { number: number; head_sha: string }): string {
  return `${kind}:${pr.number}:${pr.head_sha}`;
}

/**
 * Names a pull request action as of the pull request's head commit, so a
 * dismissed "Fix CI" or "Merge" stays dismissed until a push, or until the
 * pull request asks for something else (a review verdict turning it from
 * "Address review" to "Merge").
 */
export function prActionKey(snapshot: PrStatusSnapshot | undefined): string | null {
  const kind = prActionKind(snapshot);
  const pr = snapshot?.pr;
  return kind && pr ? actionKey(kind, pr) : null;
}

/**
 * The "For me" action list: one action per conversation, its most urgent one.
 * `attention` is the attention index (already oldest first within a state);
 * pull request actions are ordered by when the pull request last moved. A
 * conversation whose agent is at work is left out: nothing to do there yet,
 * and so is a pull request action the user marked done (`prAcks`, keyed by
 * conversation, holding the {@link prActionKey} they dismissed).
 */
export function deriveNextActions(
  attention: readonly AttentionEntry[],
  prByFeature: Readonly<Record<number, PrStatusSnapshot>>,
  prAcks: Readonly<Record<number, string>> = {},
): NextActionEntry[] {
  const best = new Map<number, { kind: NextActionKind; order: number }>();
  const working = new Set<number>();
  attention.forEach((entry, index) => {
    if (entry.state === "working") {
      working.add(entry.featureId);
      return;
    }
    // An unread conversation is a finished turn: what it asks for is a review.
    const kind = entry.state === "unread" ? "review" : entry.state;
    best.set(entry.featureId, { kind, order: index });
  });

  const prEntries = Object.values(prByFeature)
    .filter((snapshot) => !working.has(snapshot.feature_id))
    .map((snapshot) => ({ snapshot, kind: prActionKind(snapshot) }))
    .filter(
      (item): item is { snapshot: PrStatusSnapshot; kind: NextActionKind } =>
        item.kind != null &&
        !(
          item.snapshot.pr &&
          prAcks[item.snapshot.feature_id] === actionKey(item.kind, item.snapshot.pr)
        ),
    )
    .sort(
      (a, b) =>
        (a.snapshot.pr?.updated_at ?? "").localeCompare(b.snapshot.pr?.updated_at ?? "") ||
        a.snapshot.feature_id - b.snapshot.feature_id,
    );
  prEntries.forEach(({ snapshot, kind }, index) => {
    const current = best.get(snapshot.feature_id);
    if (!current || TIER[kind] < TIER[current.kind]) {
      best.set(snapshot.feature_id, { kind, order: attention.length + index });
    }
  });

  return [...best.entries()]
    .sort(([, a], [, b]) => TIER[a.kind] - TIER[b.kind] || a.order - b.order)
    .map(([featureId, { kind }]) => ({ featureId, kind }));
}

/**
 * How many of For me's `total` actions show: the "For me shows" limit (3, 5 or
 * all), or every one once "Show more" is on.
 */
export function forMeVisibleCount(
  total: number,
  limit: SidebarConfig["forMeLimit"],
  showAll: boolean,
): number {
  return showAll || limit === "all" ? total : Math.min(total, Number(limit));
}

/** A pending request or a failed turn: what turns the block's counter amber. */
export function isStrongAction({ kind }: { kind: NextActionKind }): boolean {
  return kind === "waiting" || kind === "failed";
}
