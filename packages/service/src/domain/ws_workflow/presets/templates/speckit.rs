// Three-layer prompt templates for the Speckit preset.
// Loaded from markdown files in prompts/presets/speckit/.

pub const VERSION: &str = "0.5.0";

// ── Specify ──
pub const SPECIFY_SYSTEM: &str = include_str!("../../../../../prompts/presets/speckit/specify/system.md");
pub const SPECIFY_COMMAND: &str = include_str!("../../../../../prompts/presets/speckit/specify/command.md");
pub const SPECIFY_ARTIFACT: &str = include_str!("../../../../../prompts/presets/speckit/specify/artifact.md");

// ── Plan ──
pub const PLAN_SYSTEM: &str = include_str!("../../../../../prompts/presets/speckit/plan/system.md");
pub const PLAN_COMMAND: &str = include_str!("../../../../../prompts/presets/speckit/plan/command.md");
pub const PLAN_ARTIFACT: &str = include_str!("../../../../../prompts/presets/speckit/plan/artifact.md");

// ── Tasks ──
pub const TASKS_SYSTEM: &str = include_str!("../../../../../prompts/presets/speckit/tasks/system.md");
pub const TASKS_COMMAND: &str = include_str!("../../../../../prompts/presets/speckit/tasks/command.md");
pub const TASKS_ARTIFACT: &str = include_str!("../../../../../prompts/presets/speckit/tasks/artifact.md");

// ── Implement ──
pub const IMPLEMENT_SYSTEM: &str = include_str!("../../../../../prompts/presets/speckit/implement/system.md");
pub const IMPLEMENT_COMMAND: &str = include_str!("../../../../../prompts/presets/speckit/implement/command.md");
pub const IMPLEMENT_ARTIFACT: &str = include_str!("../../../../../prompts/presets/speckit/implement/artifact.md");

// ── Pre-Analyze (pre-implementation quality gate) ──
pub const PRE_ANALYZE_SYSTEM: &str = include_str!("../../../../../prompts/presets/speckit/pre-analyze/system.md");
pub const PRE_ANALYZE_COMMAND: &str = include_str!("../../../../../prompts/presets/speckit/pre-analyze/command.md");
pub const PRE_ANALYZE_ARTIFACT: &str = include_str!("../../../../../prompts/presets/speckit/pre-analyze/artifact.md");

// ── Analyze (post-implementation review) ──
pub const ANALYZE_SYSTEM: &str = include_str!("../../../../../prompts/presets/speckit/analyze/system.md");
pub const ANALYZE_COMMAND: &str = include_str!("../../../../../prompts/presets/speckit/analyze/command.md");
pub const ANALYZE_ARTIFACT: &str = include_str!("../../../../../prompts/presets/speckit/analyze/artifact.md");
