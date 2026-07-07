import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { useIsMobile } from "@/hooks/useIsMobile";
import { XTermInstance, type XTermInstanceHandle } from "./XTermInstance";
import { TerminalPaneToolbar } from "./TerminalPaneToolbar";
import { MobileTerminalKeyBar } from "./MobileTerminalKeyBar";
import { TerminalSplitTree } from "./TerminalSplitTree";
import {
  type TerminalPanelState,
  type SplitOrientation,
  getLeaves,
  findAdjacentLeaf,
  useTerminalStore,
} from "@/hooks/useTerminalState";
import { useTheme } from "@/hooks/useTheme";
import { useWorktreeTerminalAutoSwitch } from "@/hooks/useWorktreeTerminalAutoSwitch";
import { useTerminalPaneShortcuts } from "./useTerminalPaneShortcuts";
import { desktopBridge } from "@/lib/desktop-bridge";

interface TerminalPanelProps {
  featureId: number;
  projectId: number;
  state: TerminalPanelState;
  splitPane: (leafId: string | undefined, orientation: SplitOrientation) => string | null;
  removePane: (paneId: string) => void;
  /** Working directory the feature currently expects (worktree path or project root). */
  expectedCwd: string | null;
  hotkeysEnabled?: boolean;
}

export interface TerminalPanelHandle {
  focusActivePane: () => void;
  focusFirstPane: () => void;
}

function createSlotElement(id: string): HTMLDivElement {
  const el = document.createElement("div");
  el.style.flex = "1 1 0";
  el.style.minHeight = "0";
  el.style.width = "100%";
  el.setAttribute("data-pane-slot", id);
  return el;
}

export const TerminalPanel = memo(
  forwardRef<TerminalPanelHandle, TerminalPanelProps>(function TerminalPanel(
    { featureId, projectId, state, splitPane, removePane, expectedCwd, hotkeysEnabled = true },
    ref,
  ) {
    const { isMinimized, root } = state;
    const isMobile = useIsMobile();
    const leaves = useMemo(() => (root ? getLeaves(root) : []), [root]);
    const paneRefs = useRef<Map<string, XTermInstanceHandle>>(new Map());
    const [activePaneId, setActivePaneId] = useState<string | null>(null);
    // Sticky Ctrl for the mobile key bar: armed on tap, consumed by the next
    // keystroke in the focused pane (see XTermInstance's onData handler).
    const [ctrlArmed, setCtrlArmed] = useState(false);
    const consumeCtrl = useCallback(() => setCtrlArmed(false), []);
    const toggleCtrl = useCallback(() => setCtrlArmed((v) => !v), []);
    // xterm canvas can't read CSS vars — feed the palette in as a prop.
    const { theme } = useTheme();
    const xtermPalette = theme.xterm;
    const setPtyId = useTerminalStore((s) => s.setPtyId);
    const setPaneCwd = useTerminalStore((s) => s.setPaneCwd);
    const dismissCwdWarning = useTerminalStore((s) => s.dismissCwdWarning);
    const replaceLeafWithFresh = useTerminalStore((s) => s.replaceLeafWithFresh);
    const clearInitialCommand = useTerminalStore((s) => s.clearInitialCommand);
    const clearInitialNotice = useTerminalStore((s) => s.clearInitialNotice);

    const slotsRef = useRef<Map<string, HTMLDivElement>>(new Map());
    const placeholderRefs = useRef<Map<string, HTMLDivElement>>(new Map());

    const getSlot = useCallback((id: string): HTMLDivElement => {
      let slot = slotsRef.current.get(id);
      if (!slot) {
        slot = createSlotElement(id);
        slotsRef.current.set(id, slot);
      }
      return slot;
    }, []);

    const activeSlots = leaves.map((leaf) => ({ leaf, slot: getSlot(leaf.id) }));

    // Remove slots for leaves that no longer exist. We intentionally avoid an
    // unmount cleanup that clears the whole Map because StrictMode can run it
    // mid-life and make React portal xterm into a duplicate blank slot.
    useEffect(() => {
      const activeIds = new Set(leaves.map((l) => l.id));
      for (const [id, el] of slotsRef.current) {
        if (!activeIds.has(id)) {
          el.remove();
          slotsRef.current.delete(id);
        }
      }
    }, [leaves]);

    const setPaneRef = useCallback((paneId: string, handle: XTermInstanceHandle | null) => {
      if (handle) paneRefs.current.set(paneId, handle);
      else paneRefs.current.delete(paneId);
    }, []);

    /** Blur all terminals except the given one, and update active state */
    const setActivePane = useCallback((paneId: string) => {
      setActivePaneId(paneId);
      for (const [id, handle] of paneRefs.current) {
        if (id !== paneId) handle.blur();
      }
    }, []);

    const focusPane = useCallback(
      (paneId: string) => {
        paneRefs.current.get(paneId)?.focus();
        setActivePane(paneId);
      },
      [setActivePane],
    );

    const focusPaneByIndex = useCallback(
      (index: number) => {
        if (leaves.length === 0) return;
        const clamped = Math.max(0, Math.min(leaves.length - 1, index));
        const leaf = leaves[clamped];
        if (leaf) focusPane(leaf.id);
      },
      [leaves, focusPane],
    );

    const focusFirstPane = useCallback(() => focusPaneByIndex(0), [focusPaneByIndex]);

    const activeIndex = Math.max(
      0,
      leaves.findIndex((l) => l.id === activePaneId),
    );
    const resolvedActivePaneId = leaves[activeIndex]?.id ?? null;

    // Mobile key bar: send a fixed sequence (Esc/Tab/arrows) to the focused
    // pane. These keys don't combine with Ctrl, so tapping one also disarms it.
    const sendKeyToActivePane = useCallback(
      (seq: string) => {
        const id = resolvedActivePaneId ?? leaves[0]?.id;
        if (id) paneRefs.current.get(id)?.write(seq);
        setCtrlArmed(false);
      },
      [resolvedActivePaneId, leaves],
    );

    useImperativeHandle(
      ref,
      () => ({
        focusActivePane: () => focusPaneByIndex(activeIndex),
        focusFirstPane,
      }),
      [activeIndex, focusPaneByIndex, focusFirstPane],
    );

    // Split + focus the newly-created pane. The store returns the new leaf id;
    // we focus it on the next rAF so React has had a chance to mount the new
    // XTermInstance and register its imperative handle. The `XTermInstance
    // .focus()` method itself queues the request when xterm isn't fully opened
    // yet, so even a single rAF is enough.
    const splitPaneAndFocus = useCallback(
      (paneId: string | undefined, orientation: SplitOrientation) => {
        const newId = splitPane(paneId, orientation);
        if (!newId) return;
        requestAnimationFrame(() => focusPane(newId));
      },
      [splitPane, focusPane],
    );

    const splitAndFocus = useCallback(
      (orientation: SplitOrientation) => {
        splitPaneAndFocus(resolvedActivePaneId ?? undefined, orientation);
      },
      [resolvedActivePaneId, splitPaneAndFocus],
    );

    const navigatePane = useCallback(
      (direction: "left" | "right" | "up" | "down") => {
        if (!root || !resolvedActivePaneId) return;
        const target = findAdjacentLeaf(root, resolvedActivePaneId, direction);
        if (target) focusPane(target);
      },
      [root, resolvedActivePaneId, focusPane],
    );

    // Use ref for leaves so closePane stays stable
    const leavesRef = useRef(leaves);
    leavesRef.current = leaves;

    const closePane = useCallback(
      (paneId: string) => {
        paneRefs.current.get(paneId)?.markForKill();
        const currentLeaves = leavesRef.current;
        const idx = currentLeaves.findIndex((l) => l.id === paneId);
        const neighborIndex = idx > 0 ? idx - 1 : idx + 1;
        const neighbor = currentLeaves[neighborIndex];
        removePane(paneId);
        if (neighbor) {
          requestAnimationFrame(() => focusPane(neighbor.id));
        }
      },
      [removePane, focusPane],
    );

    const closeActivePane = useCallback(() => {
      if (resolvedActivePaneId) closePane(resolvedActivePaneId);
    }, [resolvedActivePaneId, closePane]);

    const copyPaneSelection = useCallback((paneId: string) => {
      paneRefs.current.get(paneId)?.focus();
      const copied = document.execCommand("copy");
      if (copied) {
        toast.success("Terminal selection copied");
      } else {
        toast.error("No terminal selection to copy");
      }
    }, []);

    const pasteIntoPane = useCallback(async (paneId: string) => {
      try {
        const text = await (desktopBridge.readClipboardText?.() ?? navigator.clipboard.readText());
        if (text) paneRefs.current.get(paneId)?.write(text);
      } catch {
        toast.error("Failed to paste from clipboard");
      }
    }, []);

    // All terminal-pane keyboard shortcuts, scoped to the terminal tab.
    useTerminalPaneShortcuts({
      hotkeysEnabled,
      resolvedActivePaneId,
      paneRefs,
      onSplit: splitAndFocus,
      onNavigate: navigatePane,
      onClose: closePane,
    });

    const handlePaneExit = useCallback(
      (_ptyId: string, paneId: string) => {
        setTimeout(() => closePane(paneId), 500);
      },
      [closePane],
    );

    // Mark the old PTY for kill, then swap the leaf in-place so React
    // unmounts the stale XTermInstance and mounts a fresh one — which spawns
    // a new PTY at the feature's current expected cwd.
    const restartPane = useCallback(
      (paneId: string) => {
        paneRefs.current.get(paneId)?.markForKill();
        // The fresh pane spawns in `expectedCwd`; pass it as a display-only
        // notice so the new shell shows where it landed.
        replaceLeafWithFresh(featureId, paneId, expectedCwd ?? undefined);
      },
      [replaceLeafWithFresh, featureId, expectedCwd],
    );

    const dismissPaneWarning = useCallback(
      (paneId: string) => dismissCwdWarning(featureId, paneId),
      [dismissCwdWarning, featureId],
    );

    // Auto-switch idle terminals to a freshly-created worktree; panes with a
    // running command instead keep the "Restart here" warning banner.
    const warnPaneIds = useWorktreeTerminalAutoSwitch({
      featureId,
      expectedCwd,
      leaves,
      onRestartPane: restartPane,
    });

    const registerPlaceholder = useCallback((id: string, el: HTMLDivElement | null) => {
      if (el) placeholderRefs.current.set(id, el);
      else placeholderRefs.current.delete(id);
    }, []);

    // Move persistent slots into placeholders before paint
    useLayoutEffect(() => {
      for (const { leaf, slot } of activeSlots) {
        const placeholder = placeholderRefs.current.get(leaf.id);
        if (placeholder && slot.parentNode !== placeholder) {
          placeholder.appendChild(slot);
        }
      }
    }, [activeSlots]);

    return (
      <div
        className="relative flex h-full flex-col"
        data-focus-zone="terminal"
        tabIndex={0}
        onFocus={(e) => {
          if (e.target === e.currentTarget) focusFirstPane();
        }}
      >
        <TerminalPaneToolbar
          canClose={leaves.length > 0}
          onClose={closeActivePane}
          onSplit={splitAndFocus}
        />

        {/* Split tree layout — provides resizable placeholders */}
        <div
          className="min-h-0 flex-1 overflow-hidden transition-[height] duration-150 ease-in-out"
          style={isMinimized ? { height: 0, minHeight: 0 } : undefined}
        >
          {root && (
            <TerminalSplitTree
              node={root}
              expectedCwd={expectedCwd}
              warnPaneIds={warnPaneIds}
              onFocusPane={focusPane}
              onSplitPane={splitPaneAndFocus}
              onClosePane={closePane}
              onCopyPane={copyPaneSelection}
              onPastePane={pasteIntoPane}
              onRestartPane={restartPane}
              onDismissWarning={dismissPaneWarning}
              onRegisterPlaceholder={registerPlaceholder}
            />
          )}
        </div>

        {/* Touch-keyboard accessory bar — restores Esc/Tab/Ctrl/arrows on phones */}
        {isMobile && leaves.length > 0 && !isMinimized && (
          <MobileTerminalKeyBar
            ctrlArmed={ctrlArmed}
            onToggleCtrl={toggleCtrl}
            onSendKey={sendKeyToActivePane}
          />
        )}

        {/* XTermInstances via portals into persistent slot elements — never unmount */}
        {activeSlots.map(({ leaf, slot }) =>
          createPortal(
            <XTermInstance
              key={leaf.id}
              ref={(handle) => setPaneRef(leaf.id, handle)}
              featureId={featureId}
              projectId={projectId}
              existingPtyId={leaf.ptyId}
              requestedCwd={expectedCwd ?? undefined}
              theme={xtermPalette}
              initialCommand={leaf.initialCommand}
              onInitialCommandConsumed={() => clearInitialCommand(featureId, leaf.id)}
              initialNotice={leaf.initialNotice}
              onInitialNoticeConsumed={() => clearInitialNotice(featureId, leaf.id)}
              onPtyReady={(ptyId, cwd) => {
                setPtyId(featureId, leaf.id, ptyId);
                if (cwd) setPaneCwd(featureId, leaf.id, cwd);
              }}
              onExit={(ptyId) => handlePaneExit(ptyId, leaf.id)}
              onTerminalFocus={() => setActivePane(leaf.id)}
              ctrlArmed={ctrlArmed}
              onConsumeCtrl={consumeCtrl}
            />,
            slot,
            leaf.id,
          ),
        )}
      </div>
    );
  }),
);
