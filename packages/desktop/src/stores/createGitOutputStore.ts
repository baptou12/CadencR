/**
 * Factory for per-feature streaming output buffers (commit, push).
 *
 * The commit and push terminal panes share an identical lifecycle:
 *   - `start(featureId)` resets the buffer for that feature and flips
 *     `running=true`,
 *   - `append(featureId, chunk)` concatenates a raw PTY chunk (which may be
 *     a partial line, multiple lines, or carriage-return progress sequence)
 *     onto the buffer,
 *   - `complete(featureId)` flips `running=false` while preserving the
 *     buffer so the dialog still shows the final log,
 *   - `reset(featureId)` wipes both fields when the dialog closes.
 *
 * Both lifecycles are kept as **separate** Zustand stores rather than a
 * single namespaced slice — see the comment block at the top of
 * `usePushOutputStore.ts`. This factory only deduplicates the
 * implementation; consumers still pick the dedicated store.
 *
 * The buffer is capped at 100 KB; once exceeded we drop the oldest 25 KB
 * so a runaway log can't grow the React tree without bound.
 */
import { create, type StoreApi, type UseBoundStore } from "zustand";

const MAX_BYTES = 100 * 1024;
const TRIM_TO = 75 * 1024;

export interface GitOutputState {
  /** Per-feature concatenated chunk buffer. */
  byFeature: Record<number, string>;
  /** Per-feature "is the run still in progress?" flag. */
  runningByFeature: Record<number, boolean>;
  start(featureId: number): void;
  append(featureId: number, chunk: string): void;
  complete(featureId: number): void;
  /** Wipe the buffer for a feature (used when the dialog closes). */
  reset(featureId: number): void;
}

function clamp(prev: string, chunk: string): string {
  const next = prev + chunk;
  if (next.length <= MAX_BYTES) return next;
  return next.slice(next.length - TRIM_TO);
}

export interface GitOutputStoreBundle {
  useStore: UseBoundStore<StoreApi<GitOutputState>>;
  selectOutput: (featureId: number) => (s: GitOutputState) => string;
  selectRunning: (featureId: number) => (s: GitOutputState) => boolean;
}

/**
 * Build a fresh Zustand store + narrow selectors for a per-feature streaming
 * output buffer. Each call returns its own isolated store (commit and push
 * lifecycles must not share state).
 */
export function createGitOutputStore(): GitOutputStoreBundle {
  const useStore = create<GitOutputState>((set) => ({
    byFeature: {},
    runningByFeature: {},
    start(featureId) {
      set((state) => ({
        byFeature: { ...state.byFeature, [featureId]: "" },
        runningByFeature: { ...state.runningByFeature, [featureId]: true },
      }));
    },
    append(featureId, chunk) {
      set((state) => {
        const prev = state.byFeature[featureId] ?? "";
        return {
          byFeature: { ...state.byFeature, [featureId]: clamp(prev, chunk) },
        };
      });
    },
    complete(featureId) {
      set((state) => ({
        runningByFeature: { ...state.runningByFeature, [featureId]: false },
      }));
    },
    reset(featureId) {
      set((state) => {
        const nextLines = { ...state.byFeature };
        const nextRunning = { ...state.runningByFeature };
        delete nextLines[featureId];
        delete nextRunning[featureId];
        return { byFeature: nextLines, runningByFeature: nextRunning };
      });
    },
  }));

  const selectOutput =
    (featureId: number) =>
    (s: GitOutputState): string =>
      s.byFeature[featureId] ?? "";

  const selectRunning =
    (featureId: number) =>
    (s: GitOutputState): boolean =>
      s.runningByFeature[featureId] ?? false;

  return { useStore, selectOutput, selectRunning };
}
