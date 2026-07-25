import type { Shortcut } from "./types";

export const GIT_SHORTCUTS = [
  {
    id: "git-next-item",
    keys: ["j"],
    description: "Next Git item",
    scope: "diff-viewer",
    aliases: ["git", "next file"],
  },
  {
    id: "git-previous-item",
    keys: ["k"],
    description: "Previous Git item",
    scope: "diff-viewer",
    aliases: ["git", "previous file"],
  },
  {
    id: "git-open-item",
    keys: ["l"],
    description: "Open or expand Git item",
    scope: "diff-viewer",
    aliases: ["git", "expand file"],
  },
  {
    id: "git-back",
    keys: ["h"],
    description: "Collapse or go back in Git",
    scope: "diff-viewer",
    aliases: ["git", "back"],
  },
  {
    id: "git-scroll-down",
    keys: ["d"],
    description: "Scroll Git half-page down",
    scope: "diff-viewer",
    aliases: ["git"],
  },
  {
    id: "git-scroll-up",
    keys: ["u"],
    description: "Scroll Git half-page up",
    scope: "diff-viewer",
    aliases: ["git"],
  },
  {
    id: "git-toggle-viewed",
    keys: ["v"],
    description: "Toggle selected Git file viewed",
    scope: "diff-viewer",
    aliases: ["git", "reviewed"],
  },
  {
    id: "git-stage-file",
    keys: ["s"],
    description: "Stage selected Git file",
    scope: "diff-viewer",
    aliases: ["git", "add"],
  },
  {
    id: "git-reset-file",
    keys: ["r"],
    description: "Unstage selected Git file (preserve worktree)",
    scope: "diff-viewer",
    aliases: ["git", "reset"],
  },
  {
    id: "diff-toggle-sidebar",
    keys: ["mod", "e"],
    description: "Toggle Git file list",
    scope: "diff-viewer",
    aliases: ["git", "sidebar"],
  },
  {
    id: "diff-send-comments",
    keys: ["mod", "enter"],
    description: "Send pending Git comments",
    scope: "diff-viewer",
    aliases: ["git", "review"],
  },
  {
    id: "git-open-in-editor",
    keys: ["mod", "o"],
    description: "Open selected Git file in Editor",
    scope: "diff-viewer",
    aliases: ["git", "edit"],
  },
  {
    id: "git-show-uncommitted",
    keys: ["mod", "u"],
    description: "Show Git Uncommitted",
    scope: "diff-viewer",
    aliases: ["git", "changes", "working tree"],
  },
  {
    id: "git-show-vs-target",
    keys: ["mod", "t"],
    description: "Show Git vs Target",
    scope: "diff-viewer",
    aliases: ["git", "compare", "target"],
  },
  {
    // ⌘P joins the rest of the ⌘-letter Git view family. It collides with the
    // editor's fuzzy-find and the agent's model picker by combo, but those live
    // in different scopes — same deliberate overlap as ⌘T (vs-target /
    // thinking effort) and ⌘S (stashes / save).
    id: "git-show-pull-request",
    keys: ["mod", "p"],
    description: "Show pull request or merge request",
    scope: "diff-viewer",
    aliases: ["git", "review", "pull request", "merge request"],
  },
  {
    // On macOS the native application menu retains its standard Hide role.
    // Electron delivers renderer keydown first; this scoped handler consumes
    // the chord only while the Git pane owns focus and otherwise yields to Hide.
    id: "git-show-commits",
    keys: ["mod", "h"],
    description: "Show Git Commits",
    scope: "diff-viewer",
    aliases: ["git", "history", "graph"],
  },
  {
    id: "git-show-branches",
    keys: ["mod", "l"],
    description: "Show Git Branches",
    scope: "diff-viewer",
    aliases: ["git", "branch"],
  },
  {
    id: "git-show-stashes",
    keys: ["mod", "s"],
    description: "Show Git Stashes",
    scope: "diff-viewer",
    aliases: ["git", "stash"],
  },
] as const satisfies readonly Shortcut[];
