import type { PrSummary } from "@/api/generated";
import { openExternalUrl } from "@/lib/open-external";

/**
 * The host's own noun for a proposal, mid-sentence: "pull request" on
 * GitHub/Bitbucket, "merge request" on GitLab. The backend ships `pr_label`
 * capitalized for headings, so every in-sentence use goes through here.
 */
export function prNoun(pr: PrSummary): string {
  return pr.pr_label.toLowerCase();
}

/**
 * Open a pull request / merge request on its host in the default browser.
 * Shared by the Git tab's PR pane and the sidebar context menu so the failure
 * toast reads identically wherever the action lives.
 */
export async function openPullRequestExternally(pr: PrSummary): Promise<void> {
  await openExternalUrl(pr.url, `Could not open this ${prNoun(pr)}.`);
}

/** "Open pull request" / "Open merge request" — the host's own vocabulary. */
export function openPullRequestActionLabel(pr: PrSummary): string {
  return `Open ${prNoun(pr)}`;
}
