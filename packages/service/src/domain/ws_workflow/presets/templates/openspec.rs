// Three-layer prompt templates for the OpenSpec preset.
// Loaded from markdown files in prompts/presets/openspec/.

pub const VERSION: &str = "1.2.0";

// ── Propose ──
pub const PROPOSE_SYSTEM: &str = include_str!("../../../../../prompts/presets/openspec/propose/system.md");
pub const PROPOSE_COMMAND: &str = include_str!("../../../../../prompts/presets/openspec/propose/command.md");
pub const PROPOSE_ARTIFACT: &str = include_str!("../../../../../prompts/presets/openspec/propose/artifact.md");

// ── Apply ──
pub const APPLY_SYSTEM: &str = include_str!("../../../../../prompts/presets/openspec/apply/system.md");
pub const APPLY_COMMAND: &str = include_str!("../../../../../prompts/presets/openspec/apply/command.md");
pub const APPLY_ARTIFACT: &str = include_str!("../../../../../prompts/presets/openspec/apply/artifact.md");

// ── Archive ──
pub const ARCHIVE_SYSTEM: &str = include_str!("../../../../../prompts/presets/openspec/archive/system.md");
pub const ARCHIVE_COMMAND: &str = include_str!("../../../../../prompts/presets/openspec/archive/command.md");
pub const ARCHIVE_ARTIFACT: &str = include_str!("../../../../../prompts/presets/openspec/archive/artifact.md");
