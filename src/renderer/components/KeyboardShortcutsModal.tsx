import React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
      { keys: ["⌘", "⇧", "D"], description: "Feature diff" },
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
      { keys: ["⌘", "D"], description: "Agent diff (current agent)" },
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
    title: "Terminal",
    shortcuts: [
      { keys: ["^", "`"], description: "Toggle terminal" },
      { keys: ["^", "⇧", "`"], description: "New pane" },
      { keys: ["⌘", "⌥", "←/→"], description: "Switch panes" },
    ],
  },
];

function KbdKey({ label }: { label: string }) {
  return (
    <kbd className="inline-flex items-center justify-center rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] font-mono font-medium text-muted-foreground shadow-sm min-w-[20px]">
      {label}
    </kbd>
  );
}

function ShortcutRow({ keys, description }: ShortcutRow) {
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <span className="text-sm text-muted-foreground">{description}</span>
      <div className="flex items-center gap-0.5 shrink-0">
        {keys.map((key, i) => (
          <KbdKey key={i} label={key} />
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
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
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
