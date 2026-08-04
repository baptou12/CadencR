# This folder is a Cadencr theme

You are editing a **theme**, not Cadencr. `theme.json` is the whole theme: a
palette, a terminal palette, and a small closed vocabulary of shape options.
`THEME.md`, beside it, is the format reference — read it before your first edit.

## Rules

1. **Everything you may change is in this folder.** `theme.json`, and image
   files next to it. Nothing else, anywhere on this machine.

2. **Never edit Cadencr's own source.** Not its stylesheets, not its TypeScript,
   not its Rust — not even if you can see them from here. Two reasons, and both
   are absolute: people who install Cadencr have the app and not its source, so
   a change there reaches nobody; and the app's stylesheets are shared, so a
   change there silently rewrites every other theme too. A theme travels as this
   folder. If a change isn't in this folder, it isn't part of the theme.

3. **Run `./check-theme` after every edit** — `check-theme.cmd` on Windows. It
   is the app's own validator, and it is the only way you can see the verdict. A
   theme that fails it is *not applied*: the window in front of you keeps
   showing the last good theme while your change does nothing.

4. **If what you were asked for can't be expressed in `theme.json`, say so and
   stop.** The vocabulary is closed on purpose. "That isn't a theme setting —
   it's app layout" is a useful, correct answer. Reaching outside this folder to
   fake it is not, and it will be reverted.
