import { useCallback, useEffect, useRef, useState } from "react";
import { toCadencrError, type CadencrClient, type CadencrError } from "@cadencr/tab-sdk";
import { getChangedFiles } from "@cadencr/tab-sdk/api";
import { useCadencr, useStream, useTabContext, useVisibility } from "@cadencr/tab-sdk/react";

import { COMMITS_PER_FILE, LOG_FORMAT, parseLog, rankPeople, type Commit, type Person } from "./model";

/** Files whose history is read; the rest are counted, not read. */
const MAX_FILES = 40;
/** Cadencr runs at most 4 commands at a time for a tab: 3 `git log` + `git config`. */
const CONCURRENCY = 3;
/** Git pushes status often while you work; the file list rarely changes. */
const REFRESH_DEBOUNCE_MS = 1_500;

export type ReviewersState =
  | { status: "loading" }
  | { status: "error"; error: CadencrError }
  | {
      status: "ready";
      people: Person[];
      /** Where the history was read: the base branch, or HEAD without one. */
      revision: string;
      filesRead: number;
      filesSkipped: number;
    };

/** `git …` in the conversation's folder; a non-zero exit is an error here. */
async function git(client: CadencrClient, args: string[]): Promise<string> {
  const result = await client.exec.run("git", args);
  if (!result.success) {
    throw new Error(result.stderr.trim() || `git ${args[0]} exited with ${String(result.exitCode)}`);
  }
  return result.stdout;
}

async function changedPaths(featureId: number, baseBranch: string | null): Promise<string[]> {
  const lists = await Promise.all([
    getChangedFiles({ feature_id: featureId, mode: "uncommitted" }),
    baseBranch
      ? getChangedFiles({ feature_id: featureId, mode: "branch", target_branch: baseBranch })
      : Promise.resolve([]),
  ]);
  return [...new Set(lists.flat().map((file) => file.file))].sort();
}

/** `run` over `items`, `limit` at a time, in order; stops starting new ones once `current()` is false. */
async function mapLimited<T, R>(
  items: T[],
  limit: number,
  current: () => boolean,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length && current()) {
      const index = next++;
      results[index] = await run(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function loadReviewers(
  client: CadencrClient,
  paths: string[],
  baseBranch: string | null,
  current: () => boolean,
): Promise<ReviewersState> {
  const revision = baseBranch ?? "HEAD";
  const read = paths.slice(0, MAX_FILES);
  const [you, logs] = await Promise.all([
    // No Git identity set is not an error: nobody is marked "you".
    client.exec.run("git", ["config", "user.email"]).then((result) =>
      result.success ? result.stdout.trim().toLowerCase() || null : null,
    ),
    mapLimited(read, CONCURRENCY, current, (path) =>
      git(client, ["log", revision, "--no-merges", `-n${COMMITS_PER_FILE}`, `--format=${LOG_FORMAT}`, "--", path]),
    ),
  ]);
  const history = new Map<string, Commit[]>(read.map((path, index) => [path, parseLog(logs[index]!)]));
  return {
    status: "ready",
    people: rankPeople(history, you),
    revision,
    filesRead: read.length,
    filesSkipped: paths.length - read.length,
  };
}

/**
 * The ranked reviewers for the conversation's changes, kept live: a
 * `git.status` push re-reads the changed files, and the history only when
 * that list changed. Every `git` run shows in the tab's Activity in Cadencr.
 */
export function useReviewers() {
  const client = useCadencr();
  const { feature } = useTabContext();
  const visible = useVisibility();
  const [state, setState] = useState<ReviewersState>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const latest = useRef(0);
  const shownPaths = useRef<string | null>(null);
  // One load runs commands at a time: a superseded one stops starting new
  // `git log`s, and the next waits for its last ones, so two loads never
  // exceed the 4 commands Cadencr allows a tab.
  const previous = useRef<Promise<unknown>>(Promise.resolve());

  const load = useCallback(
    async (force: boolean) => {
      const request = ++latest.current;
      const current = () => request === latest.current;
      setRefreshing(true);
      try {
        const paths = await changedPaths(feature.id, feature.baseBranch);
        const key = paths.join("\n");
        if (!force && key === shownPaths.current) return;
        await previous.current;
        if (!current()) return;
        const run = loadReviewers(client, paths, feature.baseBranch, current);
        // Only sequences the next load: `run`'s error is reported just below.
        previous.current = run.catch(() => undefined);
        const next = await run;
        if (request !== latest.current) return;
        shownPaths.current = key;
        setState(next);
      } catch (error) {
        if (request !== latest.current) return;
        shownPaths.current = null;
        setState({ status: "error", error: toCadencrError(error) });
      } finally {
        if (request === latest.current) setRefreshing(false);
      }
    },
    [client, feature.id, feature.baseBranch],
  );

  useEffect(() => {
    shownPaths.current = null;
    setState({ status: "loading" });
    void load(true);
  }, [load]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void load(false), REFRESH_DEBOUNCE_MS);
  }, [load]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  // Coming back into view: the history may have changed while nobody listened.
  const wasVisible = useRef(visible);
  useEffect(() => {
    if (visible && !wasVisible.current) schedule();
    wasVisible.current = visible;
  }, [visible, schedule]);
  useStream("git.status", schedule, {
    enabled: visible,
    onResync: schedule,
    onError: (error) =>
      void client.ui.toast({
        title: "Live updates stopped",
        description: `${error.message} Use Refresh to update the list.`,
        variant: "error",
      }),
  });

  return { state, refreshing, reload: () => void load(true) };
}
