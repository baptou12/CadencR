//! Agent self-scheduling, over the MCP control plane.
//!
//! Every operation is confined to the caller's own project: an agent may only
//! see, edit, pause, or fire schedules that deliver into the project it is
//! running in. Cross-project scheduling is deliberately absent.
//!
//! There is no delete route. Disabling is the terminal state, so a schedule an
//! agent retires stays visible (and its run history readable) instead of
//! vanishing from under the user.

use axum::extract::State;
use axum::http::StatusCode;
use axum::{routing::post, Json, Router};
use serde::{Deserialize, Serialize};

#[path = "schedules_audit.rs"]
mod schedule_audit;
#[path = "schedules_summary.rs"]
mod summary;

use self::schedule_audit::{record_schedule_audit, ScheduleAuditEvent};
use self::summary::ScheduleSummary;
use super::audit::result_size_bytes;
use super::scope::{resolve_session_scope, SessionScope};
use crate::app_state::AppState;
use crate::domain::schedules::models::{
    RecurrenceInput, SaveScheduleRequest, Schedule, ScheduleTarget, TargetKind,
};
use crate::domain::schedules::repository::{self, ScheduleFilter};
use crate::domain::schedules::service;
use crate::error::AppError;

/// Rows one listing returns. A project accumulates schedules over months; the
/// agent only needs the soonest slice to avoid creating a duplicate.
const DEFAULT_LIST_LIMIT: usize = 50;

pub(super) fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/internal/mcp/project/schedule/list",
            post(list_schedules_handler),
        )
        .route(
            "/internal/mcp/project/schedule/save",
            post(save_schedule_handler),
        )
        .route(
            "/internal/mcp/project/schedule/set-enabled",
            post(set_schedule_enabled_handler),
        )
        .route(
            "/internal/mcp/project/schedule/run",
            post(run_schedule_handler),
        )
}

#[derive(Debug, Deserialize)]
struct ListSchedulesRequest {
    source_session_id: i64,
    limit: Option<usize>,
}

#[derive(Debug, Serialize)]
struct ListSchedulesResponse {
    project_id: i64,
    count: usize,
    schedules: Vec<ScheduleSummary>,
}

/// Create-or-update. A `schedule_id` means update; its absence means create.
#[derive(Debug, Deserialize)]
struct SaveScheduleControlRequest {
    source_session_id: i64,
    schedule_id: Option<i64>,
    name: Option<String>,
    prompt: String,
    target: ScheduleTarget,
    recurrence: RecurrenceInput,
    /// Deliberately not defaulted, unlike [`SaveScheduleRequest::enabled`]: an
    /// agent arming a schedule must say so, and a missing field is an error
    /// rather than a silent `true`.
    enabled: Option<bool>,
}

#[derive(Debug, Serialize)]
struct SavedScheduleResponse {
    id: i64,
    enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    next_run_at: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SetScheduleEnabledControlRequest {
    source_session_id: i64,
    schedule_id: i64,
    enabled: bool,
}

#[derive(Debug, Serialize)]
struct SetScheduleEnabledResponse {
    id: i64,
    enabled: bool,
    previous_enabled: bool,
}

#[derive(Debug, Deserialize)]
struct RunScheduleRequest {
    source_session_id: i64,
    schedule_id: i64,
}

#[derive(Debug, Serialize)]
struct RunScheduleResponse {
    id: i64,
    run_triggered: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    feature_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

async fn list_schedules_handler(
    State(state): State<AppState>,
    Json(body): Json<ListSchedulesRequest>,
) -> Result<Json<ListSchedulesResponse>, AppError> {
    let source = resolve_session_scope(&state.read_pool, body.source_session_id).await?;
    let limit = body
        .limit
        .unwrap_or(DEFAULT_LIST_LIMIT)
        .clamp(1, DEFAULT_LIST_LIMIT);
    let schedules: Vec<ScheduleSummary> = repository::list(
        &state.read_pool,
        ScheduleFilter {
            feature_id: None,
            project_id: Some(source.project_id),
        },
    )
    .await?
    .into_iter()
    .take(limit)
    .map(ScheduleSummary::from_schedule)
    .collect();
    Ok(Json(ListSchedulesResponse {
        project_id: source.project_id,
        count: schedules.len(),
        schedules,
    }))
}

async fn save_schedule_handler(
    State(state): State<AppState>,
    Json(body): Json<SaveScheduleControlRequest>,
) -> Result<Json<SavedScheduleResponse>, AppError> {
    let started_at = std::time::Instant::now();
    let source = resolve_session_scope(&state.read_pool, body.source_session_id).await?;
    let (previous, outcome) = save_scoped(&state, &source, body).await;
    finish_write(
        &state,
        &source,
        "project_save_schedule",
        previous,
        outcome,
        started_at,
    )
    .await
}

async fn set_schedule_enabled_handler(
    State(state): State<AppState>,
    Json(body): Json<SetScheduleEnabledControlRequest>,
) -> Result<Json<SetScheduleEnabledResponse>, AppError> {
    let started_at = std::time::Instant::now();
    let source = resolve_session_scope(&state.read_pool, body.source_session_id).await?;
    let (previous, outcome) = match load_scoped(&state, &source, body.schedule_id).await {
        Ok(previous) => {
            let outcome =
                repository::set_enabled(&state.write_pool, body.schedule_id, body.enabled)
                    .await
                    .map(|updated| SetScheduleEnabledResponse {
                        id: updated.id,
                        enabled: updated.enabled,
                        previous_enabled: previous.enabled,
                    });
            (Some(previous), outcome)
        }
        Err(error) => (None, Err(error)),
    };
    finish_write(
        &state,
        &source,
        "project_set_schedule_enabled",
        previous,
        outcome,
        started_at,
    )
    .await
}

async fn run_schedule_handler(
    State(state): State<AppState>,
    Json(body): Json<RunScheduleRequest>,
) -> Result<Json<RunScheduleResponse>, AppError> {
    let started_at = std::time::Instant::now();
    let source = resolve_session_scope(&state.read_pool, body.source_session_id).await?;
    let outcome = match load_scoped(&state, &source, body.schedule_id).await {
        Ok(_) => service::run_now(&state, body.schedule_id)
            .await
            .map(|result| RunScheduleResponse {
                id: body.schedule_id,
                run_triggered: result.ran,
                feature_id: result.feature_id,
                error: result.error,
            }),
        Err(error) => Err(error),
    };
    // A manual run changes no configuration, so there is nothing to restore.
    finish_write(
        &state,
        &source,
        "project_run_schedule",
        None,
        outcome,
        started_at,
    )
    .await
}

async fn save_scoped(
    state: &AppState,
    source: &SessionScope,
    body: SaveScheduleControlRequest,
) -> (Option<Schedule>, Result<SavedScheduleResponse, AppError>) {
    let previous = match body.schedule_id {
        Some(id) => match load_scoped(state, source, id).await {
            Ok(schedule) => Some(schedule),
            Err(error) => return (None, Err(error)),
        },
        None => None,
    };
    (previous, write_schedule(state, source, body).await)
}

async fn write_schedule(
    state: &AppState,
    source: &SessionScope,
    body: SaveScheduleControlRequest,
) -> Result<SavedScheduleResponse, AppError> {
    // Defence in depth behind the tool schema's `required`: a schedule that
    // quietly defaults to armed is exactly the surprise this tool must never
    // produce, so an absent flag is refused rather than filled in.
    let enabled = body.enabled.ok_or_else(|| {
        AppError::coded(
            StatusCode::BAD_REQUEST,
            "ENABLED_REQUIRED",
            "enabled must be passed explicitly as true or false",
        )
    })?;
    let request = SaveScheduleRequest {
        name: body.name,
        prompt: body.prompt,
        target: scoped_target(&state.read_pool, source, body.target).await?,
        recurrence: body.recurrence,
        enabled: Some(enabled),
    };
    // Recurrence and target validation stay in the domain; its `AppError`s
    // surface to the agent unchanged.
    let saved = match body.schedule_id {
        Some(id) => repository::update(&state.write_pool, id, request).await?,
        None => repository::insert(&state.write_pool, request).await?,
    };
    Ok(SavedScheduleResponse {
        id: saved.id,
        enabled: saved.enabled,
        next_run_at: saved.next_run_at,
    })
}

/// Load a schedule the caller is allowed to touch. Anything firing into another
/// project is invisible from here, so it can neither be read nor moved.
async fn load_scoped(
    state: &AppState,
    source: &SessionScope,
    schedule_id: i64,
) -> Result<Schedule, AppError> {
    let schedule = repository::get(&state.read_pool, schedule_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("schedule {schedule_id} not found")))?;
    if schedule.context.project_id != Some(source.project_id) {
        return Err(not_in_project(format!(
            "schedule {schedule_id} does not belong to the current project"
        )));
    }
    Ok(schedule)
}

/// Pin a save to the caller's project. An explicitly foreign project is refused
/// rather than rewritten, so a mistargeted schedule is never silently moved
/// into the caller's project instead of failing.
async fn scoped_target(
    pool: &sqlx::SqlitePool,
    source: &SessionScope,
    mut target: ScheduleTarget,
) -> Result<ScheduleTarget, AppError> {
    match target.kind {
        TargetKind::Conversation => {
            let feature_id = target.feature_id.ok_or_else(|| {
                AppError::BadRequest("a conversation schedule needs feature_id".into())
            })?;
            let project_id: i64 =
                sqlx::query_scalar("SELECT project_id FROM features WHERE id = ?")
                    .bind(feature_id)
                    .fetch_optional(pool)
                    .await?
                    .ok_or_else(|| {
                        AppError::NotFound(format!("conversation {feature_id} not found"))
                    })?;
            if project_id != source.project_id {
                return Err(not_in_project(format!(
                    "conversation {feature_id} does not belong to the current project"
                )));
            }
        }
        TargetKind::NewConversation => match target.project_id {
            Some(project_id) if project_id != source.project_id => {
                return Err(not_in_project(format!(
                    "project {project_id} is not the current project"
                )))
            }
            _ => target.project_id = Some(source.project_id),
        },
    }
    Ok(target)
}

fn not_in_project(message: String) -> AppError {
    AppError::coded(StatusCode::FORBIDDEN, "SCHEDULE_NOT_IN_PROJECT", message)
}

/// Audit the write, then hand back its outcome.
///
/// `previous` is recorded only when the write actually landed: an audit row
/// carrying an undo payload for a change that never happened would be worse
/// than no payload at all.
async fn finish_write<T: Serialize>(
    state: &AppState,
    source: &SessionScope,
    tool_name: &str,
    previous: Option<Schedule>,
    outcome: Result<T, AppError>,
    started_at: std::time::Instant,
) -> Result<Json<T>, AppError> {
    let previous_value = match (&outcome, previous.as_ref()) {
        (Ok(_), Some(schedule)) => serde_json::to_value(schedule).ok(),
        _ => None,
    };
    let error = outcome.as_ref().err().map(ToString::to_string);
    record_schedule_audit(
        state,
        source,
        ScheduleAuditEvent {
            tool_name,
            status: if error.is_none() { "ok" } else { "error" },
            result_size_bytes: outcome.as_ref().map(result_size_bytes).unwrap_or(0),
            error: error.as_deref(),
            previous_value,
            started_at,
        },
    )
    .await?;
    outcome.map(Json)
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use sqlx::SqlitePool;

    use super::*;
    use crate::shared::migrate::{run_migrations, MigrationContext};

    const CALLER_SESSION: i64 = 777;
    const CALLER_FEATURE: i64 = 42;
    const FOREIGN_FEATURE: i64 = 43;

    /// Two projects, a conversation in each, and one caller session pinned to
    /// the first — the minimum needed to tell "mine" from "not mine".
    async fn fixture() -> (AppState, SessionScope) {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        run_migrations(&MigrationContext::pool_only(&pool))
            .await
            .unwrap();
        sqlx::raw_sql(
            "INSERT INTO projects (id, name, path) VALUES (7, 'Current', '/tmp/current'), (8, 'Other', '/tmp/other');
             INSERT INTO features (id, project_id, title, status, type) VALUES
                 (42, 7, 'Caller', 'active', 'ws-session'),
                 (43, 8, 'Foreign', 'active', 'ws-session');
             INSERT INTO agent_sessions (id, feature_id, agent_type, status)
             VALUES (777, 42, 'session', 'paused');",
        )
        .execute(&pool)
        .await
        .unwrap();
        let state = AppState::with_pool(pool);
        let source = resolve_session_scope(&state.read_pool, CALLER_SESSION)
            .await
            .unwrap();
        (state, source)
    }

    /// A daily new-conversation save, as the tool would post it.
    fn save_body(overrides: serde_json::Value) -> SaveScheduleControlRequest {
        let mut body = json!({
            "source_session_id": CALLER_SESSION,
            "prompt": "summarise yesterday",
            "target": { "kind": "new_conversation" },
            "recurrence": { "kind": "daily", "time_of_day": "09:00", "timezone": "UTC" }
        });
        for (key, value) in overrides.as_object().unwrap() {
            body[key] = value.clone();
        }
        serde_json::from_value(body).expect("save request")
    }

    async fn audit_rows(state: &AppState, tool_name: &str) -> Vec<(String, Option<String>)> {
        sqlx::query_as(
            "SELECT status, previous_value FROM mcp_tool_audit_log
             WHERE tool_name = ? ORDER BY id",
        )
        .bind(tool_name)
        .fetch_all(&state.read_pool)
        .await
        .unwrap()
    }

    fn coded(error: &AppError) -> &'static str {
        match error {
            AppError::Coded { code, .. } => *code,
            other => panic!("expected a coded error, got {other}"),
        }
    }

    // The product rule the whole tool exists to enforce: an agent has to decide
    // whether the schedule is armed, so an omitted flag is a refusal and no row
    // is written.
    #[tokio::test]
    async fn saving_without_an_explicit_enabled_flag_is_refused() {
        let (state, _) = fixture().await;

        let error = save_schedule_handler(State(state.clone()), Json(save_body(json!({}))))
            .await
            .unwrap_err();

        assert_eq!(coded(&error), "ENABLED_REQUIRED");
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM schedules")
            .fetch_one(&state.read_pool)
            .await
            .unwrap();
        assert_eq!(count, 0);
        assert_eq!(
            audit_rows(&state, "project_save_schedule").await,
            vec![("error".to_string(), None)]
        );
    }

    #[tokio::test]
    async fn saving_into_another_project_is_refused() {
        let (state, _) = fixture().await;

        let foreign_project = save_schedule_handler(
            State(state.clone()),
            Json(save_body(json!({
                "enabled": true,
                "target": { "kind": "new_conversation", "project_id": 8 }
            }))),
        )
        .await
        .unwrap_err();
        assert_eq!(coded(&foreign_project), "SCHEDULE_NOT_IN_PROJECT");

        let foreign_conversation = save_schedule_handler(
            State(state.clone()),
            Json(save_body(json!({
                "enabled": true,
                "target": { "kind": "conversation", "feature_id": FOREIGN_FEATURE }
            }))),
        )
        .await
        .unwrap_err();
        assert_eq!(coded(&foreign_conversation), "SCHEDULE_NOT_IN_PROJECT");

        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM schedules")
            .fetch_one(&state.read_pool)
            .await
            .unwrap();
        assert_eq!(count, 0);
    }

    // An omitted project_id is the normal case: the tool is project-scoped, so
    // the caller's project is filled in rather than demanded.
    #[tokio::test]
    async fn a_create_targets_the_callers_own_project() {
        let (state, _) = fixture().await;

        let saved = save_schedule_handler(
            State(state.clone()),
            Json(save_body(json!({ "enabled": false }))),
        )
        .await
        .unwrap()
        .0;

        assert!(!saved.enabled);
        assert!(saved.next_run_at.is_some());
        let project_id: i64 = sqlx::query_scalar("SELECT project_id FROM schedules WHERE id = ?")
            .bind(saved.id)
            .fetch_one(&state.read_pool)
            .await
            .unwrap();
        assert_eq!(project_id, 7);
        // Nothing existed before a create, so there is no undo payload.
        assert_eq!(
            audit_rows(&state, "project_save_schedule").await,
            vec![("ok".to_string(), None)]
        );
    }

    #[tokio::test]
    async fn an_update_records_the_schedule_as_it_was() {
        let (state, _) = fixture().await;
        let created = save_schedule_handler(
            State(state.clone()),
            Json(save_body(json!({ "enabled": true }))),
        )
        .await
        .unwrap();

        let updated = save_schedule_handler(
            State(state.clone()),
            Json(save_body(json!({
                "enabled": true,
                "schedule_id": created.id,
                "prompt": "summarise the week"
            }))),
        )
        .await
        .unwrap();

        assert_eq!(updated.id, created.id);
        let audits = audit_rows(&state, "project_save_schedule").await;
        assert_eq!(audits.len(), 2);
        let previous: serde_json::Value =
            serde_json::from_str(audits[1].1.as_deref().expect("previous value")).unwrap();
        assert_eq!(previous["id"], created.id);
        assert_eq!(previous["prompt"], "summarise yesterday");
    }

    #[tokio::test]
    async fn updating_a_schedule_from_another_project_is_refused() {
        let (state, _) = fixture().await;
        // A schedule owned by the other project, created straight through the
        // domain so it bypasses the scoping this tool applies.
        let foreign = repository::insert(
            &state.write_pool,
            serde_json::from_value(json!({
                "prompt": "not yours",
                "target": { "kind": "conversation", "feature_id": FOREIGN_FEATURE },
                "recurrence": { "kind": "daily", "time_of_day": "09:00" },
                "enabled": true
            }))
            .unwrap(),
        )
        .await
        .unwrap();

        let error = save_schedule_handler(
            State(state.clone()),
            Json(save_body(
                json!({ "enabled": true, "schedule_id": foreign.id }),
            )),
        )
        .await
        .unwrap_err();

        assert_eq!(coded(&error), "SCHEDULE_NOT_IN_PROJECT");
        let prompt: String = sqlx::query_scalar("SELECT prompt FROM schedules WHERE id = ?")
            .bind(foreign.id)
            .fetch_one(&state.read_pool)
            .await
            .unwrap();
        assert_eq!(prompt, "not yours");
    }

    #[tokio::test]
    async fn set_enabled_reports_and_audits_the_previous_state() {
        let (state, _) = fixture().await;
        let created = save_schedule_handler(
            State(state.clone()),
            Json(save_body(json!({ "enabled": true }))),
        )
        .await
        .unwrap();

        let response = set_schedule_enabled_handler(
            State(state.clone()),
            Json(
                serde_json::from_value(json!({
                    "source_session_id": CALLER_SESSION,
                    "schedule_id": created.id,
                    "enabled": false
                }))
                .unwrap(),
            ),
        )
        .await
        .unwrap();

        assert_eq!(response.id, created.id);
        assert!(!response.enabled);
        assert!(response.previous_enabled);
        let audits = audit_rows(&state, "project_set_schedule_enabled").await;
        assert_eq!(audits.len(), 1);
        let previous: serde_json::Value =
            serde_json::from_str(audits[0].1.as_deref().expect("previous value")).unwrap();
        assert_eq!(previous["enabled"], true);
    }

    #[tokio::test]
    async fn set_enabled_refuses_a_schedule_from_another_project() {
        let (state, _) = fixture().await;
        let foreign = repository::insert(
            &state.write_pool,
            serde_json::from_value(json!({
                "prompt": "not yours",
                "target": { "kind": "conversation", "feature_id": FOREIGN_FEATURE },
                "recurrence": { "kind": "daily", "time_of_day": "09:00" },
                "enabled": true
            }))
            .unwrap(),
        )
        .await
        .unwrap();

        let error = set_schedule_enabled_handler(
            State(state.clone()),
            Json(
                serde_json::from_value(json!({
                    "source_session_id": CALLER_SESSION,
                    "schedule_id": foreign.id,
                    "enabled": false
                }))
                .unwrap(),
            ),
        )
        .await
        .unwrap_err();

        assert_eq!(coded(&error), "SCHEDULE_NOT_IN_PROJECT");
        let enabled: i64 = sqlx::query_scalar("SELECT enabled FROM schedules WHERE id = ?")
            .bind(foreign.id)
            .fetch_one(&state.read_pool)
            .await
            .unwrap();
        assert_eq!(enabled, 1);
    }

    #[tokio::test]
    async fn the_listing_is_compact_and_scoped_to_the_callers_project() {
        let (state, _) = fixture().await;
        let long_prompt = "x".repeat(150);
        save_schedule_handler(
            State(state.clone()),
            Json(save_body(json!({
                "enabled": true,
                "name": "Standup",
                "prompt": long_prompt
            }))),
        )
        .await
        .unwrap();
        repository::insert(
            &state.write_pool,
            serde_json::from_value(json!({
                "prompt": "another project's rule",
                "target": { "kind": "conversation", "feature_id": FOREIGN_FEATURE },
                "recurrence": { "kind": "daily", "time_of_day": "09:00" },
                "enabled": true
            }))
            .unwrap(),
        )
        .await
        .unwrap();

        let listed = list_schedules_handler(
            State(state.clone()),
            Json(serde_json::from_value(json!({ "source_session_id": CALLER_SESSION })).unwrap()),
        )
        .await
        .unwrap();

        assert_eq!(listed.project_id, 7);
        assert_eq!(listed.count, 1);
        let row = serde_json::to_value(&listed.schedules[0]).unwrap();
        assert_eq!(row["name"], "Standup");
        assert_eq!(row["recurrence"], "daily at 09:00 UTC");
        assert_eq!(row["enabled"], true);
        assert_eq!(row["completed"], false);
        assert_eq!(row["run_count"], 0);
        assert!(row["next_run_at"].is_string());
        // Compact by construction: the full prompt and the target config are
        // the two things a listing must never spend tokens on.
        assert_eq!(row["prompt_preview"].as_str().unwrap().chars().count(), 101);
        assert!(row.get("prompt").is_none());
        assert!(row.get("target").is_none());
    }

    #[tokio::test]
    async fn run_refuses_a_schedule_from_another_project() {
        let (state, _) = fixture().await;
        let foreign = repository::insert(
            &state.write_pool,
            serde_json::from_value(json!({
                "prompt": "not yours",
                "target": { "kind": "conversation", "feature_id": FOREIGN_FEATURE },
                "recurrence": { "kind": "daily", "time_of_day": "09:00" },
                "enabled": true
            }))
            .unwrap(),
        )
        .await
        .unwrap();

        let error = run_schedule_handler(
            State(state.clone()),
            Json(
                serde_json::from_value(json!({
                    "source_session_id": CALLER_SESSION,
                    "schedule_id": foreign.id
                }))
                .unwrap(),
            ),
        )
        .await
        .unwrap_err();

        assert_eq!(coded(&error), "SCHEDULE_NOT_IN_PROJECT");
        let run_count: i64 = sqlx::query_scalar("SELECT run_count FROM schedules WHERE id = ?")
            .bind(foreign.id)
            .fetch_one(&state.read_pool)
            .await
            .unwrap();
        assert_eq!(run_count, 0);
    }

    // The run itself cannot deliver here — there is no agent behind the test
    // conversation — but the trigger must still reach the domain: a history row
    // is written and the manual run is audited either way.
    #[tokio::test]
    async fn run_triggers_the_domain_run_path_and_records_history() {
        let (state, _) = fixture().await;
        let created = save_schedule_handler(
            State(state.clone()),
            Json(save_body(json!({
                "enabled": true,
                "target": { "kind": "conversation", "feature_id": CALLER_FEATURE }
            }))),
        )
        .await
        .unwrap();

        let response = run_schedule_handler(
            State(state.clone()),
            Json(
                serde_json::from_value(json!({
                    "source_session_id": CALLER_SESSION,
                    "schedule_id": created.id
                }))
                .unwrap(),
            ),
        )
        .await
        .unwrap();

        assert_eq!(response.id, created.id);
        let (run_count, last_status): (i64, Option<String>) =
            sqlx::query_as("SELECT run_count, last_status FROM schedules WHERE id = ?")
                .bind(created.id)
                .fetch_one(&state.read_pool)
                .await
                .unwrap();
        assert_eq!(run_count, 1);
        assert!(last_status.is_some());
        // A run restores nothing, so it never carries an undo payload.
        let audits = audit_rows(&state, "project_run_schedule").await;
        assert_eq!(audits.len(), 1);
        assert_eq!(audits[0].1, None);
    }
}
