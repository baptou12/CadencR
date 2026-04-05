// Three-layer prompt templates for the Cadence Default preset.
// Loaded from markdown files in prompts/presets/cadence-default/.

// ── Plan ──
pub const PLAN_SYSTEM: &str = include_str!("../../../../../prompts/presets/cadence-default/plan/system.md");
pub const PLAN_COMMAND: &str = include_str!("../../../../../prompts/presets/cadence-default/plan/command.md");
pub const PLAN_ARTIFACT: &str = include_str!("../../../../../prompts/presets/cadence-default/plan/artifact.md");

// ── PRD ──
pub const PRD_SYSTEM: &str = include_str!("../../../../../prompts/presets/cadence-default/prd/system.md");
pub const PRD_COMMAND: &str = include_str!("../../../../../prompts/presets/cadence-default/prd/command.md");
pub const PRD_ARTIFACT: &str = include_str!("../../../../../prompts/presets/cadence-default/prd/artifact.md");

// ── Build ──
pub const BUILD_SYSTEM: &str = include_str!("../../../../../prompts/presets/cadence-default/build/system.md");
pub const BUILD_COMMAND: &str = include_str!("../../../../../prompts/presets/cadence-default/build/command.md");
pub const BUILD_ARTIFACT: &str = include_str!("../../../../../prompts/presets/cadence-default/build/artifact.md");
