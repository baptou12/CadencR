import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { KbdShortcut } from "@/components/KbdShortcut";

interface ShortcutRow {
  keys: string[];
  description: string;
}

interface ShortcutGroup {
  title: string;
  shortcuts: ShortcutRow[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "Global",
    shortcuts: [
      { keys: ["⌘", "K"], description: "Open command palette" },
      { keys: ["⌘", ","], description: "Open settings" },
      { keys: ["⌘", "N"], description: "New feature" },
      { keys: ["⌘", "⇧", "N"], description: "New session" },
      { keys: ["⌘", "⇧", "X"], description: "Delete feature" },
      { keys: ["⌘", "Esc"], description: "Stop all agents" },
      { keys: ["⌘", "+"], description: "Zoom in" },
      { keys: ["⌘", "−"], description: "Zoom out" },
      { keys: ["⌘", "0"], description: "Reset zoom" },
      { keys: ["⌘", "?"], description: "Show this help" },
    ],
  },
  {
    title: "Navigation",
    shortcuts: [
      { keys: ["⌘", "⌥", "←/→"], description: "Cycle focus zones" },
      { keys: ["⌘", "⌥", "↑/↓"], description: "Navigate within zone" },
      { keys: ["Enter"], description: "Activate focused item" },
    ],
  },
  {
    title: "Feature / Workflow",
    shortcuts: [
      { keys: ["⌘", "⇧", "G"], description: "Git panel" },
      { keys: ["⌘", "⇧", "P"], description: "Feature settings" },
      { keys: ["⌘", "⇧", "B"], description: "Start / continue build" },
      { keys: ["⌘", "⇧", "S"], description: "Start session" },
      { keys: ["⌘", "⇧", "M"], description: "Merge & archive" },
      { keys: ["⌘", "M"], description: "Mark session agent done" },
      { keys: ["⌘", "1"], description: "Approve plan" },
      { keys: ["⌘", "2"], description: "Request plan changes" },
    ],
  },
  {
    title: "Agent / Prompt",
    shortcuts: [
      { keys: ["⌘", "G"], description: "Agent diff (current agent)" },
      { keys: ["⌘", "P"], description: "Cycle model" },
      { keys: ["⌘", "Enter"], description: "Maximize agent" },
      { keys: ["⌘", "⇧", "Z"], description: "Collapse agent" },
      { keys: ["⇧", "Tab"], description: "Toggle permission mode" },
      { keys: ["Esc"], description: "Stop agent" },
      { keys: ["Enter"], description: "Send message" },
    ],
  },
  {
    title: "Diff Viewer",
    shortcuts: [
      { keys: ["^", "J"], description: "Next file" },
      { keys: ["^", "K"], description: "Previous file" },
      { keys: ["^", "L"], description: "Toggle file" },
      { keys: ["^", "D"], description: "Scroll down" },
      { keys: ["^", "U"], description: "Scroll up" },
      { keys: ["^", "H"], description: "Toggle viewed" },
      { keys: ["⌘", "Enter"], description: "Send comments" },
    ],
  },
  {
    title: "Questions & Permissions",
    shortcuts: [
      { keys: ["⌘", "1–9"], description: "Select option" },
      { keys: ["Enter"], description: "Submit" },
      { keys: ["⌘", "1"], description: "Allow once" },
      { keys: ["⌘", "2"], description: "Allow future" },
      { keys: ["⌘", "3"], description: "Deny" },
    ],
  },
  {
    title: "Editor",
    shortcuts: [
      { keys: ["⌘", "⇧", "E"], description: "Editor tab" },
      { keys: ["⌘", "P"], description: "Fuzzy file search" },
      { keys: ["⌘", "S"], description: "Save file" },
      { keys: ["⌘", "W"], description: "Close tab" },
      { keys: ["⌘", "⌥", "["], description: "Previous sub-tab" },
      { keys: ["⌘", "⌥", "]"], description: "Next sub-tab" },
      { keys: ["⌘", "D"], description: "Split pane vertically" },
      { keys: ["⌘", "⇧", "D"], description: "Split pane horizontally" },
      { keys: ["⌘", "⌥", "←/→/↑/↓"], description: "Navigate panes" },
    ],
  },
  {
    title: "Terminal",
    shortcuts: [
      { keys: ["^", "`"], description: "Toggle terminal" },
      { keys: ["⌘", "D"], description: "Split vertical" },
      { keys: ["⌘", "⇧", "D"], description: "Split horizontal" },
      { keys: ["⌘", "⌥", "←/→"], description: "Switch panes" },
    ],
  },
];

function ShortcutRow({ keys, description }: ShortcutRow) {
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <span className="text-sm text-foreground">{description}</span>
      <div className="flex items-center gap-0.5 shrink-0">
        {keys.map((key, i) => (
          <KbdShortcut key={i} keys={[key]} variant="modal" />
        ))}
      </div>
    </div>
  );
}

interface KeyboardShortcutsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function KeyboardShortcutsModal({ open, onOpenChange }: KeyboardShortcutsModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-x-8 gap-y-4 mt-2">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.title}>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground mb-2 pb-1 border-b border-border">
                {group.title}
              </h3>
              <div className="divide-y divide-border/50">
                {group.shortcuts.map((shortcut, i) => (
                  <ShortcutRow key={i} {...shortcut} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
