use serde::Serialize;

use crate::domain::schedules::models::Schedule;
use crate::domain::schedules::recurrence::{Recurrence, RecurrenceKind};

/// Longest prompt excerpt a listing returns. A schedule prompt can be a whole
/// briefing; the list exists to tell schedules apart before creating a
/// duplicate, not to reproduce them.
const PROMPT_PREVIEW_CHARS: usize = 100;

const WEEKDAY_NAMES: [&str; 7] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/// One schedule as an agent sees it: enough to recognise the rule, never the
/// full prompt or the target configuration.
#[derive(Debug, Serialize)]
pub(super) struct ScheduleSummary {
    pub id: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub prompt_preview: String,
    pub recurrence: String,
    pub enabled: bool,
    pub completed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_run_at: Option<String>,
    pub run_count: i64,
}

impl ScheduleSummary {
    pub(super) fn from_schedule(schedule: Schedule) -> Self {
        Self {
            id: schedule.id,
            name: schedule.name,
            prompt_preview: preview(&schedule.prompt),
            recurrence: recurrence_summary(&schedule.recurrence),
            enabled: schedule.enabled,
            completed: schedule.completed,
            next_run_at: schedule.next_run_at,
            run_count: schedule.run_count,
        }
    }
}

fn preview(prompt: &str) -> String {
    let prompt = prompt.trim();
    let mut preview: String = prompt.chars().take(PROMPT_PREVIEW_CHARS).collect();
    if prompt.chars().count() > PROMPT_PREVIEW_CHARS {
        preview.push('…');
    }
    preview
}

/// One-line rendering of the rule, so an agent can tell a nightly sweep from a
/// one-shot follow-up without a second call.
fn recurrence_summary(recurrence: &Recurrence) -> String {
    let time = recurrence.time_of_day.as_deref().unwrap_or("00:00");
    let zone = recurrence.timezone.as_str();
    match recurrence.kind {
        RecurrenceKind::Once => "once".to_string(),
        RecurrenceKind::Interval => format!(
            "every {} seconds",
            recurrence.interval_seconds.unwrap_or_default()
        ),
        RecurrenceKind::Daily => format!("daily at {time} {zone}"),
        RecurrenceKind::Weekly => format!("weekly on {} at {time} {zone}", weekdays(recurrence)),
        RecurrenceKind::Monthly => format!(
            "monthly on day {} at {time} {zone}",
            recurrence.day_of_month.unwrap_or(1)
        ),
    }
}

fn weekdays(recurrence: &Recurrence) -> String {
    recurrence
        .weekdays
        .as_deref()
        .unwrap_or_default()
        .iter()
        .filter_map(|day| WEEKDAY_NAMES.get(usize::try_from(*day).ok()?.checked_sub(1)?))
        .copied()
        .collect::<Vec<_>>()
        .join(",")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rule(
        kind: RecurrenceKind,
        interval_seconds: Option<i64>,
        time_of_day: Option<&str>,
        weekdays: Option<Vec<i64>>,
        day_of_month: Option<i64>,
    ) -> Recurrence {
        Recurrence::parse(
            kind,
            interval_seconds,
            time_of_day.map(ToString::to_string),
            weekdays,
            day_of_month,
            Some("Europe/Paris".into()),
        )
        .unwrap()
    }

    #[test]
    fn every_rule_kind_renders_as_one_line() {
        assert_eq!(
            recurrence_summary(&rule(RecurrenceKind::Once, None, None, None, None)),
            "once"
        );
        assert_eq!(
            recurrence_summary(&rule(
                RecurrenceKind::Interval,
                Some(1_800),
                None,
                None,
                None
            )),
            "every 1800 seconds"
        );
        assert_eq!(
            recurrence_summary(&rule(
                RecurrenceKind::Daily,
                None,
                Some("09:00"),
                None,
                None
            )),
            "daily at 09:00 Europe/Paris"
        );
        assert_eq!(
            recurrence_summary(&rule(
                RecurrenceKind::Weekly,
                None,
                Some("09:00"),
                Some(vec![1, 4]),
                None
            )),
            "weekly on Mon,Thu at 09:00 Europe/Paris"
        );
        assert_eq!(
            recurrence_summary(&rule(
                RecurrenceKind::Monthly,
                None,
                Some("09:00"),
                None,
                Some(3)
            )),
            "monthly on day 3 at 09:00 Europe/Paris"
        );
    }

    // Truncation counts characters, not bytes: a prompt that starts with
    // multi-byte text must not panic on a mid-codepoint slice.
    #[test]
    fn a_long_prompt_is_truncated_with_an_ellipsis() {
        let short = preview("re-check CI");
        assert_eq!(short, "re-check CI");

        let long = preview(&"é".repeat(150));
        assert_eq!(long.chars().count(), PROMPT_PREVIEW_CHARS + 1);
        assert!(long.ends_with('…'));
    }
}
