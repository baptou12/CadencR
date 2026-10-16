use serde_json::{json, Value};

use crate::domain::schedules::condition::{DEFAULT_TIMEOUT_SECONDS, MAX_TIMEOUT_SECONDS};
use crate::domain::schedules::recurrence::MIN_INTERVAL_SECONDS;

pub(super) const DESCRIPTION: &str = "Schedule a prompt to be sent back into this conversation later — once, every N seconds, or daily/weekly/monthly at a local time. Add a condition to only send it when a shell command fails (non-zero exit): the command runs in this conversation's working copy at every evaluation, and its output is appended to the prompt. While this conversation's agent is working or waiting on the user, evaluations are skipped. The user sees, edits, pauses, and deletes the schedule in CadencR's Schedules view; tell them what you scheduled.";

/// Flat on purpose, like `project_spawn_session`: a `oneOf` per recurrence
/// kind would be more precise, but MCP clients generate far worse arguments
/// for unions than for one object with documented, kind-specific fields. The
/// save path rejects fields that don't match the kind.
pub(super) fn schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "prompt": { "type": "string", "description": "The message delivered to this conversation when the schedule fires. Write it as instructions to your future self: the conversation history is still there, but say what to check and do." },
            "name": { "type": "string", "description": "Short label shown in the Schedules list. Optional; defaults to the prompt's first line." },
            "recurrence": {
                "type": "object",
                "description": "When the schedule fires (or, with a condition, when the command is evaluated).",
                "properties": {
                    "kind": { "type": "string", "enum": ["once", "interval", "daily", "weekly", "monthly"], "description": "once needs run_at; interval needs interval_seconds; daily needs time_of_day; weekly needs time_of_day and weekdays; monthly needs time_of_day and day_of_month." },
                    "run_at": { "type": "string", "description": "once only: future ISO-8601 instant with offset, e.g. 2026-10-17T09:00:00+02:00." },
                    "interval_seconds": { "type": "number", "description": format!("interval only: seconds between runs, at least {MIN_INTERVAL_SECONDS}.") },
                    "time_of_day": { "type": "string", "description": "daily/weekly/monthly: local wall-clock time as HH:MM (24h)." },
                    "weekdays": { "type": "array", "items": { "type": "number" }, "description": "weekly only: ISO weekdays, 1 = Monday .. 7 = Sunday." },
                    "day_of_month": { "type": "number", "description": "monthly only: 1-31, clamped to shorter months' last day." },
                    "timezone": { "type": "string", "description": "IANA zone time_of_day is read in. Omit to use the user's machine timezone." }
                },
                "required": ["kind"]
            },
            "condition": {
                "type": "object",
                "description": "Optional gate: only deliver when this command exits non-zero. Omit to always deliver.",
                "properties": {
                    "command": { "type": "string", "description": "Shell command run through the user's login shell in this conversation's working directory, e.g. `pnpm test` or `curl -fsS http://localhost:3000/health`. Must be non-interactive." },
                    "timeout_seconds": { "type": "number", "description": format!("Seconds before the evaluation is abandoned and reported as an error (1-{MAX_TIMEOUT_SECONDS}, default {DEFAULT_TIMEOUT_SECONDS}).") }
                },
                "required": ["command"]
            },
            "model": { "type": "string", "description": "Optional model for the scheduled turn; defaults to the conversation's current model." },
            "thinking_level": { "type": "string", "description": "Optional thinking level for the scheduled turn." },
            "permission_mode": { "type": "string", "description": "Optional collaboration mode for the scheduled turn (e.g. default, plan)." }
        },
        "required": ["prompt", "recurrence"]
    })
}
