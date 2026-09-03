use serde_json::{json, Value};

/// Input schemas for the self-scheduling tools. Every property carries its own
/// description because the nested `target`/`recurrence` objects are where an
/// agent is most likely to guess wrong.
pub(super) fn schema(name: &str) -> Value {
    match name {
        "project_list_schedules" => json!({
            "type": "object",
            "properties": {
                "limit": {
                    "type": "number",
                    "description": "Maximum schedules to return, soonest run first. Defaults to 50 and is clamped there."
                }
            }
        }),
        "project_save_schedule" => save_schema(),
        "project_set_schedule_enabled" => json!({
            "type": "object",
            "properties": {
                "schedule_id": {
                    "type": "number",
                    "description": "Schedule to pause or resume; it must belong to this project."
                },
                "enabled": {
                    "type": "boolean",
                    "description": "true resumes the schedule, false pauses it. Disabling is how a schedule is retired — there is no delete."
                }
            },
            "required": ["schedule_id", "enabled"]
        }),
        _ => json!({
            "type": "object",
            "properties": {
                "schedule_id": {
                    "type": "number",
                    "description": "Schedule to fire immediately; it must belong to this project."
                }
            },
            "required": ["schedule_id"]
        }),
    }
}

fn save_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "schedule_id": {
                "type": "number",
                "description": "Omit to create. Pass an id from project_list_schedules to replace that schedule's rule; its run history is kept."
            },
            "name": {
                "type": "string",
                "description": "Short label shown in the schedules list."
            },
            "prompt": {
                "type": "string",
                "description": "Prompt delivered when the schedule fires. Write it for an agent that has none of this conversation's context."
            },
            "enabled": {
                "type": "boolean",
                "description": "Required, with no default. true arms the schedule immediately; false saves it paused. Decide deliberately: an armed recurring schedule runs unattended."
            },
            "target": target_schema(),
            "recurrence": recurrence_schema()
        },
        "required": ["prompt", "target", "recurrence", "enabled"]
    })
}

fn target_schema() -> Value {
    json!({
        "type": "object",
        "description": "Where the schedule delivers. It must stay inside the current project.",
        "properties": {
            "kind": {
                "type": "string",
                "enum": ["conversation", "new_conversation"],
                "description": "conversation delivers into an existing conversation; new_conversation starts a fresh session on every run."
            },
            "feature_id": {
                "type": "number",
                "description": "Conversation to deliver into. Required when kind is conversation, and it must belong to this project."
            },
            "project_id": {
                "type": "number",
                "description": "Project the new conversation is created in. Defaults to the current project and may not name another one."
            },
            "provider": {
                "type": "string",
                "description": "Agent to run with (new_conversation only; an existing conversation is already bound to its provider). See project_list_agent_providers."
            },
            "model": {
                "type": "string",
                "description": "Model to run with. Applies to both kinds — a nightly sweep may use a cheaper model than the conversation it lands in."
            },
            "thinking_level": {
                "type": "string",
                "description": "Provider/model-specific thinking or reasoning level."
            },
            "permission_mode": {
                "type": "string",
                "description": "Collaboration mode the run starts in, such as default or plan."
            },
            "access_mode": {
                "type": "string",
                "description": "Provider access/sandbox mode; ignored by providers that do not offer one."
            },
            "profile": {
                "type": "string",
                "description": "Claude Code profile the run bills against."
            },
            "worktree_mode": {
                "type": "string",
                "enum": ["new", "reuse", "skip"],
                "description": "Worktree strategy for new_conversation runs. Defaults to skip, which works in the project root."
            },
            "reuse_branch": {
                "type": "string",
                "description": "Existing branch to reuse when worktree_mode is reuse."
            },
            "base_branch": {
                "type": "string",
                "description": "Base branch to cut from when worktree_mode is new, commonly main."
            }
        },
        "required": ["kind"]
    })
}

fn recurrence_schema() -> Value {
    json!({
        "type": "object",
        "description": "How often the schedule fires. Prefer once for follow-ups; a repeating rule runs unattended until it is disabled.",
        "properties": {
            "kind": {
                "type": "string",
                "enum": ["once", "interval", "daily", "weekly", "monthly"],
                "description": "Recurrence rule. once fires a single time and then completes."
            },
            "run_at": {
                "type": "string",
                "description": "ISO-8601 instant the schedule fires at. Required when kind is once, and it must be in the future."
            },
            "interval_seconds": {
                "type": "number",
                "description": "Seconds between runs when kind is interval; 60 is the shortest accepted interval."
            },
            "time_of_day": {
                "type": "string",
                "description": "Local HH:MM, required for daily, weekly, and monthly rules."
            },
            "weekdays": {
                "type": "array",
                "items": { "type": "number" },
                "description": "ISO weekdays for a weekly rule: 1 is Monday through 7 is Sunday."
            },
            "day_of_month": {
                "type": "number",
                "description": "Day 1-31 for a monthly rule, clamped to the last day of shorter months."
            },
            "timezone": {
                "type": "string",
                "description": "IANA timezone the wall-clock fields are read in; defaults to UTC."
            }
        },
        "required": ["kind"]
    })
}
