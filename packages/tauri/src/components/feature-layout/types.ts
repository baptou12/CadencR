import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import type { TabKind } from "@/stores/feature-layout-schema";

/**
 * Per-tab metadata supplied by consumers (ws-session / FeatureWorkflowView).
 *
 * The `content` is mounted exactly once at the top of `<FeatureLayoutShell>`
 * and projected via `createPortal` into whichever pane currently hosts it —
 * hence the runtime guarantee that PTY/CodeMirror/agent-WS state survive
 * pane moves.
 */
export interface FeatureTabDef {
  label: string;
  Icon: LucideIcon;
  /** Optional badge rendered inside the tab trigger (git stats, terminal pane count, …). */
  badge?: ReactNode;
  /** Hotkey label shown in tooltip, e.g. ["cmd", "shift", "A"]. */
  shortcut?: string[];
  /** Tab body. Rendered once; portaled into the active pane. */
  content: ReactNode;
}

export type FeatureTabs = Record<TabKind, FeatureTabDef>;

export type DragSource = { kind: "pane"; paneId: string; tab: TabKind };

export type DropTarget =
  | { kind: "pane-edge"; paneId: string; edge: "top" | "right" | "bottom" | "left" }
  | { kind: "pane-strip"; paneId: string };
