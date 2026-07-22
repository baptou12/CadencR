import { useEffect, useRef } from "react";
import type { FileTree } from "@pierre/trees";
import { FileStageState, type ChangedFile } from "@/api/generated";
import { useFileTreeShadowStylesheet } from "@/components/file-tree/useFileTreeShadowStylesheet";
import { getGitFileActionAvailability, type GitFileIndexActions } from "./useGitFileIndexActions";
import { resolvedStageState } from "./useGitDiffFileTreeModel";

const CHECKBOX_ATTR = "data-cadencr-stage-checkbox";
const PATH_ATTR = "data-cadencr-stage-path";

/** Search chrome + checkbox layout for the git diff file tree shadow root. */
export const GIT_DIFF_TREE_SHADOW_CSS = `
[data-file-tree-search-container] {
  padding: var(--trees-padding-inline);
  margin-bottom: 0;
}
[data-item-type="file"] {
  padding-inline-start: 2px;
}
[${CHECKBOX_ATTR}] {
  appearance: auto;
  width: 13px;
  height: 13px;
  margin: 0 6px 0 4px;
  flex-shrink: 0;
  align-self: center;
  accent-color: var(--primary);
  cursor: pointer;
}
[${CHECKBOX_ATTR}]:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
`;

/** Search-only chrome when stage checkboxes are off (e.g. branch compare). */
export const GIT_DIFF_TREE_SEARCH_CSS = `
[data-file-tree-search-container] {
  padding: var(--trees-padding-inline);
  margin-bottom: 0;
}
`;

function checkboxVisualState(stageState: ReturnType<typeof resolvedStageState>): {
  checked: boolean;
  indeterminate: boolean;
} | null {
  if (stageState === FileStageState.not_applicable) return null;
  return {
    checked: stageState === FileStageState.staged || stageState === FileStageState.both,
    indeterminate: stageState === FileStageState.both,
  };
}

function ensureCheckboxInput(row: HTMLElement, path: string): HTMLInputElement {
  let input = row.querySelector<HTMLInputElement>(`input[${CHECKBOX_ATTR}]`);
  if (input) return input;
  input = document.createElement("input");
  input.type = "checkbox";
  input.setAttribute(CHECKBOX_ATTR, "");
  input.setAttribute("aria-label", `Stage ${path}`);
  const icon = row.querySelector('[data-item-section="icon"]');
  if (icon) icon.before(input);
  else row.prepend(input);
  return input;
}

function syncRowCheckbox(
  row: HTMLElement,
  file: ChangedFile | undefined,
  indexActions: GitFileIndexActions,
): void {
  const path = row.getAttribute("data-item-path");
  if (!path || !file) {
    row.querySelector(`input[${CHECKBOX_ATTR}]`)?.remove();
    return;
  }
  const stageState = resolvedStageState(file);
  const visual = checkboxVisualState(stageState);
  if (!visual) {
    row.querySelector(`input[${CHECKBOX_ATTR}]`)?.remove();
    return;
  }

  const input = ensureCheckboxInput(row, path);
  input.setAttribute(PATH_ATTR, path);
  const pendingHere =
    indexActions.pendingPath === path &&
    (indexActions.pendingAction === "stage" || indexActions.pendingAction === "reset");
  const availability = getGitFileActionAvailability(stageState);
  const canToggle =
    (visual.checked && availability.canReset) || (!visual.checked && availability.canStage);
  const disabled = indexActions.isPending || pendingHere || !canToggle;
  if (input.disabled !== disabled) input.disabled = disabled;
  if (input.checked !== visual.checked) input.checked = visual.checked;
  if (input.indeterminate !== visual.indeterminate) input.indeterminate = visual.indeterminate;
}

function syncAllFileRows(
  shadowRoot: ShadowRoot,
  byPath: ReadonlyMap<string, ChangedFile>,
  indexActions: GitFileIndexActions,
): void {
  for (const row of shadowRoot.querySelectorAll<HTMLElement>('[data-item-type="file"]')) {
    const path = row.getAttribute("data-item-path");
    syncRowCheckbox(row, path ? byPath.get(path) : undefined, indexActions);
  }
}

function shadowRootOf(model: FileTree): ShadowRoot | null {
  const getContainer = model.getFileTreeContainer;
  if (typeof getContainer !== "function") return null;
  return getContainer.call(model)?.shadowRoot ?? null;
}

function bindStageCheckboxEvents(
  shadowRoot: ShadowRoot,
  fileByPathRef: { current: ReadonlyMap<string, ChangedFile> },
  actionsRef: { current: GitFileIndexActions },
): () => void {
  const stopCheckboxEventPropagation = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !target.hasAttribute(CHECKBOX_ATTR)) return;
    event.stopPropagation();
  };
  const onChange = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !target.hasAttribute(CHECKBOX_ATTR)) return;
    event.stopPropagation();
    const path = target.getAttribute(PATH_ATTR);
    if (!path) return;
    const file = fileByPathRef.current.get(path);
    if (!file) return;
    const stageState = resolvedStageState(file);
    const visual = checkboxVisualState(stageState);
    if (!visual) return;
    target.checked = visual.checked;
    target.indeterminate = visual.indeterminate;
    if (visual.checked || visual.indeterminate) {
      actionsRef.current.reset(path);
      return;
    }
    actionsRef.current.stage(path, {
      conflicted: stageState === FileStageState.conflicted,
    });
  };
  shadowRoot.addEventListener("pointerdown", stopCheckboxEventPropagation, true);
  shadowRoot.addEventListener("click", stopCheckboxEventPropagation, true);
  shadowRoot.addEventListener("change", onChange, true);
  return () => {
    shadowRoot.removeEventListener("pointerdown", stopCheckboxEventPropagation, true);
    shadowRoot.removeEventListener("click", stopCheckboxEventPropagation, true);
    shadowRoot.removeEventListener("change", onChange, true);
  };
}

/**
 * Injects native stage checkboxes into Pierre file rows (shadow DOM) and keeps
 * them in sync with Git stage state. Pierre virtualizes rows, so sync runs on
 * every model notification.
 */
export function useGitDiffStageCheckboxes(
  model: FileTree,
  files: readonly ChangedFile[],
  indexActions: GitFileIndexActions,
  enabled: boolean,
): void {
  useFileTreeShadowStylesheet(
    model,
    "data-cadencr-git-diff-tree",
    enabled ? GIT_DIFF_TREE_SHADOW_CSS : GIT_DIFF_TREE_SEARCH_CSS,
  );
  const fileByPathRef = useRef(new Map<string, ChangedFile>());
  const actionsRef = useRef(indexActions);
  fileByPathRef.current = new Map(files.map((file) => [file.file, file]));
  actionsRef.current = indexActions;

  useEffect(() => {
    if (!enabled) {
      shadowRootOf(model)
        ?.querySelectorAll(`input[${CHECKBOX_ATTR}]`)
        .forEach((node) => node.remove());
      return;
    }

    const sync = (): void => {
      const shadowRoot = shadowRootOf(model);
      if (shadowRoot) syncAllFileRows(shadowRoot, fileByPathRef.current, actionsRef.current);
    };

    let detachShadow: (() => void) | null = null;
    let rafId = 0;
    let attempts = 0;
    const attach = (): void => {
      const shadowRoot = shadowRootOf(model);
      if (!shadowRoot) {
        if (++attempts < 60) rafId = requestAnimationFrame(attach);
        return;
      }
      detachShadow = bindStageCheckboxEvents(shadowRoot, fileByPathRef, actionsRef);
      sync();
    };

    attach();
    const unsubscribe =
      typeof model.subscribe === "function" ? model.subscribe(sync) : () => undefined;
    return () => {
      if (rafId !== 0) cancelAnimationFrame(rafId);
      unsubscribe();
      detachShadow?.();
    };
  }, [enabled, model]);

  useEffect(() => {
    if (!enabled) return;
    const shadowRoot = shadowRootOf(model);
    if (shadowRoot) syncAllFileRows(shadowRoot, fileByPathRef.current, indexActions);
  }, [enabled, files, indexActions, model]);
}
