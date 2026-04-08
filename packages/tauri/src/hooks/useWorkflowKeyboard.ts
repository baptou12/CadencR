import { useState, useRef, useCallback, useEffect } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { type AgentSessionHandle } from "@/components/agent-session";
import { getActiveFocusZone } from "@/lib/focus-zones";
import type { FeatureSession } from "@/hooks/useFeatureAgentState";
import type { WorkflowBackend } from "@/hooks/workflowBackendTypes";

/**
 * Manages all keyboard shortcuts and agent focus navigation for the workflow view.
 * Returns refs and state needed by the rendering layer.
 */
export function useWorkflowKeyboard(
  backend: WorkflowBackend,
  openAgent: string | null,
  setOpenAgent: React.Dispatch<React.SetStateAction<string | null>>,
  onViewDiff: () => void,
) {
  const agentRefs = useRef<Map<number, AgentSessionHandle>>(new Map());

  const setAgentRef = useCallback(
    (index: number, handle: AgentSessionHandle | null) => {
      if (handle) agentRefs.current.set(index, handle);
      else agentRefs.current.delete(index);
    },
    [],
  );

  const moveFocus = useCallback(
    (direction: "up" | "down") => {
      const count = backend.sessionEntries.length;
      if (count === 0) return;
      let currentAgentIndex = -1;
      let el: HTMLElement | null = document.activeElement as HTMLElement | null;
      while (el) {
        const attr = el.getAttribute("data-agent-container");
        if (attr != null) { currentAgentIndex = Number(attr); break; }
        el = el.parentElement;
      }
      let nextIndex: number;
      if (currentAgentIndex === -1) {
        nextIndex = direction === "down" ? 0 : count - 1;
      } else if (direction === "down") {
        nextIndex = currentAgentIndex >= count - 1 ? 0 : currentAgentIndex + 1;
      } else {
        nextIndex = currentAgentIndex <= 0 ? count - 1 : currentAgentIndex - 1;
      }
      agentRefs.current.get(nextIndex)?.focusActiveInput();
    },
    [backend.sessionEntries],
  );

  useHotkeys("meta+alt+down", (e) => {
    const zone = getActiveFocusZone();
    if (zone && zone !== "main-content") return;
    e.preventDefault();
    moveFocus("down");
  }, { enableOnFormTags: true, enableOnContentEditable: true });

  useHotkeys("meta+alt+up", (e) => {
    const zone = getActiveFocusZone();
    if (zone && zone !== "main-content") return;
    e.preventDefault();
    moveFocus("up");
  }, { enableOnFormTags: true, enableOnContentEditable: true });

  useHotkeys("enter", (e) => {
    if (getActiveFocusZone() !== "main-content") return;
    const focused = document.activeElement as HTMLElement | null;
    if (!focused?.hasAttribute("data-nav-item")) return;
    const agentIndexStr = focused.getAttribute("data-nav-agent-index");
    if (agentIndexStr == null) return;
    const agentIndex = Number(agentIndexStr);
    const entry = backend.sessionEntries[agentIndex];
    if (!entry) return;
    e.preventDefault();
    const sessionKey = `${entry.agentType}-${entry.sessionDbId}`;
    const isWorking = entry.status === "running" || entry.status === "paused";
    if (isWorking) {
      if (openAgent !== sessionKey) setOpenAgent(sessionKey);
      requestAnimationFrame(() => agentRefs.current.get(agentIndex)?.focusActiveInput());
    } else {
      const willOpen = openAgent !== sessionKey;
      setOpenAgent((prev) => (prev === sessionKey ? null : sessionKey));
      if (willOpen) requestAnimationFrame(() => agentRefs.current.get(agentIndex)?.focusPromptBar());
    }
  }, { enableOnFormTags: false });

  useHotkeys("meta+alt+z", (e) => {
    if (getActiveFocusZone() !== "main-content") return;
    e.preventDefault();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    const zone = document.querySelector('[data-focus-zone="main-content"]');
    if (zone instanceof HTMLElement) zone.focus();
  }, { enableOnFormTags: true, enableOnContentEditable: true });

  useHotkeys("meta+shift+b", (e) => {
    if (backend.canContinueBuild && !backend.isContinuingBuild) {
      e.preventDefault();
      backend.continueWorkflow();
    } else if (backend.actions.canStartBuild && !backend.canContinueBuild && !backend.isStartingExecute) {
      e.preventDefault();
      backend.startBuilding();
    }
  }, { enableOnFormTags: true, enableOnContentEditable: true });

  const [sessionPromptTrigger, setSessionPromptTrigger] = useState(0);
  useHotkeys("meta+shift+s", (e) => {
    if (!backend.actions.canStartWorkflowSession || backend.isStartingWorkflowSession) return;
    e.preventDefault();
    setSessionPromptTrigger((v) => v + 1);
  }, { enableOnFormTags: true, enableOnContentEditable: true });

  useHotkeys("escape", (e) => {
    if (getActiveFocusZone() !== "main-content") return;
    const focused = document.activeElement as HTMLElement | null;
    if (!focused?.hasAttribute("data-nav-item")) return;
    const agentIndexStr = focused.getAttribute("data-nav-agent-index");
    if (agentIndexStr == null) return;
    const entry = backend.sessionEntries[Number(agentIndexStr)];
    if (!entry || entry.status !== "running") return;
    e.preventDefault();
    if (entry.agentType === "execute" && entry.subprocessId) backend.interruptAgent(entry);
    else backend.stopAgent(entry);
  }, { enableOnFormTags: true, enableOnContentEditable: true });

  // Auto-focus first agent on mount
  const didAutoFocusRef = useRef(false);
  useEffect(() => {
    if (didAutoFocusRef.current || backend.sessionEntries.length === 0) return;
    didAutoFocusRef.current = true;
    requestAnimationFrame(() => agentRefs.current.get(0)?.focusPromptBar());
  }, [backend.sessionEntries.length]);

  // Auto-focus newly started agents
  const prevRunningAgentsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const currentRunning = new Set(
      backend.sessionEntries
        .filter((e) => e.status === "running" || e.status === "paused")
        .map((e) => `${e.agentType}-${e.sessionDbId}`),
    );
    for (const key of currentRunning) {
      if (!prevRunningAgentsRef.current.has(key)) {
        const index = backend.sessionEntries.findIndex((e) => `${e.agentType}-${e.sessionDbId}` === key);
        if (index >= 0) requestAnimationFrame(() => agentRefs.current.get(index)?.focusPromptBar());
        break;
      }
    }
    prevRunningAgentsRef.current = currentRunning;
  }, [backend.sessionEntries]);

  const getFocusedEntry = useCallback((): FeatureSession | null => {
    let el: HTMLElement | null = document.activeElement as HTMLElement | null;
    while (el) {
      const attr = el.getAttribute("data-agent-container");
      if (attr != null) return backend.sessionEntries[Number(attr)] ?? null;
      el = el.parentElement;
    }
    return null;
  }, [backend.sessionEntries]);

  useHotkeys("meta+g", (e) => {
    e.preventDefault();
    if (getFocusedEntry()) onViewDiff();
  }, { enableOnFormTags: true, enableOnContentEditable: true });

  useHotkeys("meta+m", (e) => {
    e.preventDefault();
    const entry = getFocusedEntry();
    if (!entry) return;
    if (entry.agentType !== "session" && entry.agentType !== "review-fixer") return;
    if (entry.status !== "running" && entry.status !== "paused") return;
    backend.markDone(entry.sessionDbId);
  }, { enableOnFormTags: true, enableOnContentEditable: true });

  useHotkeys("meta+1", (e) => {
    e.preventDefault();
    const entry = getFocusedEntry();
    if (!entry || !entry.pendingPlanApproval || !entry.subprocessId) return;
    backend.approvePlan(entry.subprocessId);
  }, { enableOnFormTags: true, enableOnContentEditable: true });

  useHotkeys("meta+2", (e) => {
    e.preventDefault();
    const entry = getFocusedEntry();
    if (!entry || !entry.pendingPlanApproval) return;
    const idx = backend.sessionEntries.indexOf(entry);
    if (idx >= 0) agentRefs.current.get(idx)?.focusActiveInput();
  }, { enableOnFormTags: true, enableOnContentEditable: true });

  return {
    agentRefs,
    setAgentRef,
    sessionPromptTrigger,
  };
}
