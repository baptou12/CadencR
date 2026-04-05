// Three-layer prompt templates for the BMAD preset.
// Loaded from markdown files in prompts/presets/bmad/.

pub const VERSION: &str = "6.2.2";

// ── Analysis ──
pub const ANALYSIS_SYSTEM: &str = include_str!("../../../../../prompts/presets/bmad/analysis/system.md");
pub const ANALYSIS_COMMAND: &str = include_str!("../../../../../prompts/presets/bmad/analysis/command.md");
pub const ANALYSIS_ARTIFACT: &str = include_str!("../../../../../prompts/presets/bmad/analysis/artifact.md");

// ── Planning ──
pub const PLANNING_SYSTEM: &str = include_str!("../../../../../prompts/presets/bmad/planning/system.md");
pub const PLANNING_COMMAND: &str = include_str!("../../../../../prompts/presets/bmad/planning/command.md");
pub const PLANNING_ARTIFACT: &str = include_str!("../../../../../prompts/presets/bmad/planning/artifact.md");

// ── Solutioning ──
pub const SOLUTIONING_SYSTEM: &str = include_str!("../../../../../prompts/presets/bmad/solutioning/system.md");
pub const SOLUTIONING_COMMAND: &str = include_str!("../../../../../prompts/presets/bmad/solutioning/command.md");
pub const SOLUTIONING_ARTIFACT: &str = include_str!("../../../../../prompts/presets/bmad/solutioning/artifact.md");

// ── Implementation ──
pub const IMPLEMENTATION_SYSTEM: &str = include_str!("../../../../../prompts/presets/bmad/implementation/system.md");
pub const IMPLEMENTATION_COMMAND: &str = include_str!("../../../../../prompts/presets/bmad/implementation/command.md");
pub const IMPLEMENTATION_ARTIFACT: &str = include_str!("../../../../../prompts/presets/bmad/implementation/artifact.md");
