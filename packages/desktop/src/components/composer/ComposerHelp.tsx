import type { ReactElement } from "react";
import { useShortcutLabel } from "@/hooks/useShortcutLabel";
import { formatCompactCombo } from "@/lib/shortcuts/format";
import type { ShortcutId } from "@/lib/shortcuts/registry";

/** A literal trigger, or a registry shortcut shown as currently bound (`twice`: pressed twice). */
type HelpKey = string | { shortcut: ShortcutId; twice?: boolean };

const ROWS: ReadonlyArray<readonly [string, HelpKey, string]> = [
  ["file", "@", "Attach a file or folder"],
  ["conversation", "@@", "Reference another conversation"],
  ["command", "/", "Commands and skills"],
  ["side", "/cadencr:side", "Ask on the side — the agent is not interrupted"],
  ["shell", "!", "Run a shell command yourself"],
  ["send", "↵", "Send — or steer the agent while it works"],
  ["queue", { shortcut: "agent-send" }, "Queue for after the agent's turn"],
  ["newline", formatCompactCombo(["shift", "enter"]), "New line"],
  ["walk", "↑ ↓", "Walk your prompt history"],
  ["search", { shortcut: "prompt-history-search" }, "Search history and stashed drafts"],
  ["stash", { shortcut: "prompt-stash-draft" }, "Stash the draft"],
  ["mode", { shortcut: "agent-permission-mode" }, "Change the autonomy mode"],
  ["stop", { shortcut: "agent-stop", twice: true }, "Stop the agent"],
  [
    "add",
    { shortcut: "editor-add-selection-to-prompt" },
    "In the Editor or Terminal: add the selection here",
  ],
];

/** The composer's grammar, one screen: what each trigger and key does. */
export function ComposerHelp(): ReactElement {
  return (
    <div className="p-3">
      <p className="mb-2 text-[13px] font-medium">Composer keys & syntax</p>
      <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1.5 text-xs">
        {ROWS.map(([id, key, label]) => (
          <div key={id} className="contents">
            <dt>
              <kbd className="rounded border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-[11px]">
                {typeof key === "string" ? key : <BoundKey {...key} />}
              </kbd>
            </dt>
            <dd className="text-muted-foreground">{label}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function BoundKey({ shortcut, twice }: { shortcut: ShortcutId; twice?: boolean }): string {
  const label = useShortcutLabel(shortcut);
  return twice ? `${label} ${label}` : label;
}
