/**
 * Per-feature streaming buffer for the commit dialog's terminal pane.
 *
 * The backend's `git/commit.start` resets the buffer; each
 * `git/commit.output` envelope appends one *chunk* (raw PTY read — may
 * be a partial line, multiple lines, or carriage-return progress
 * sequences); `git/commit.complete` marks the run as finished.
 *
 * Storing a single growing `string` (rather than `Line[]`) mirrors how
 * `WorktreeSetupSection` renders setup output — the `<pre>` displays
 * the whole feed verbatim and a real terminal feel falls out for free.
 *
 * Implementation lives in {@link createGitOutputStore} — kept identical to
 * `usePushOutputStore` because the WS lifecycle is identical. Public hook
 * + selector exports are preserved byte-identically; consumers compile
 * unchanged.
 */
import { createGitOutputStore } from "./createGitOutputStore";

const bundle = createGitOutputStore();

export const useCommitOutputStore = bundle.useStore;

/** Narrow selector: the buffer for a single feature, or `""` when absent. */
export const selectCommitOutput = bundle.selectOutput;

/** Narrow selector: whether the commit is currently running. */
export const selectCommitRunning = bundle.selectRunning;
