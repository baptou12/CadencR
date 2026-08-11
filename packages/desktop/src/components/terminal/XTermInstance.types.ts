import type { XTermPalette } from "@/lib/themes";

export interface XTermInstanceProps {
  featureId: number;
  projectId: number;
  existingPtyId?: string;
  requestedCwd?: string;
  theme: XTermPalette;
  /** Resolved monospace font stack from useMonoFont(). */
  fontFamily?: string;
  onExit?: (ptyId: string) => void;
  onPtyReady?: (ptyId: string, cwd: string | null) => void;
  killOnUnmount?: boolean;
  initialCommand?: string;
  onInitialCommandConsumed?: () => void;
  initialNotice?: string;
  onInitialNoticeConsumed?: () => void;
  onTerminalFocus?: () => void;
  ctrlArmed?: boolean;
  onConsumeCtrl?: () => void;
}

export interface XTermInstanceHandle {
  focus: () => void;
  clearScreen: () => void;
  clearInput: () => void;
  blur: () => void;
  markForKill: () => void;
  write: (data: string) => void;
}
