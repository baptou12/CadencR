Max 400 lines per file and 100 lines per function — past that, split into modules/components or smaller named functions. Test files are exempt.
(oxlint `max-lines` / `max-lines-per-function` enforce this for TS — see .oxlintrc.json; a PostToolUse hook in .claude/settings.json checks `.rs` files. The service stays under the limit with a `foo.rs` + sibling `foo/` directory layout.)
