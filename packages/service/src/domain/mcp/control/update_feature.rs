use axum::http::StatusCode;
use axum::{extract::State, routing::post, Json, Router};
use serde::{Deserialize, Serialize};

#[path = "update_feature_apply.rs"]
mod apply;

use self::apply::{
    apply_changes, ensure_no_other_running_session, load_snapshot, notify_feature_update,
};
use super::audit::{elapsed_ms, record_tool_audit, result_size_bytes, ToolAudit};
use super::scope::{resolve_session_scope, SessionScope};
use super::steward::ensure_workspace_write_authority;
use crate::app_state::AppState;
use crate::domain::features::models::FeatureStatus;
use crate::domain::mcp::write_scope::WriteScope;
use crate::error::AppError;

#[derive(Debug, Deserialize)]
pub(super) struct UpdateFeatureRequest {
    source_session_id: i64,
    feature_id: i64,
    title: Option<String>,
    /// Double option: an absent key leaves the label alone, an explicit `null`
    /// clears it. Plain `Option<String>` cannot tell those two apart.
    #[serde(default, deserialize_with = "present_field")]
    label: Option<Option<String>>,
    pinned: Option<bool>,
    status: Option<String>,
}

fn present_field<'de, D>(deserializer: D) -> Result<Option<Option<String>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Option::deserialize(deserializer).map(Some)
}

/// The feature's organization metadata. One shape for the `previous` echo, the
/// `updated` echo, and the audit snapshot so they can never drift apart.
#[derive(Debug, Clone, Serialize)]
pub(super) struct FeatureState {
    pub title: String,
    pub label: Option<String>,
    pub pinned: bool,
    pub status: String,
}

#[derive(Debug, Serialize)]
pub(super) struct UpdateFeatureResponse {
    updated: FeatureState,
    previous: FeatureState,
}

/// The columns this request touches; `None` means the caller left the field out.
#[derive(Debug)]
pub(super) struct FeatureChanges {
    pub title: Option<String>,
    pub label: Option<Option<String>>,
    pub pinned: Option<bool>,
    pub status: Option<FeatureStatus>,
}

impl FeatureChanges {
    fn is_empty(&self) -> bool {
        self.title.is_none()
            && self.label.is_none()
            && self.pinned.is_none()
            && self.status.is_none()
    }

    fn applied_to(&self, previous: &FeatureState) -> FeatureState {
        FeatureState {
            title: self.title.clone().unwrap_or_else(|| previous.title.clone()),
            label: self.label.clone().unwrap_or_else(|| previous.label.clone()),
            pinned: self.pinned.unwrap_or(previous.pinned),
            status: self.status.map_or_else(
                || previous.status.clone(),
                |status| status.as_str().to_string(),
            ),
        }
    }
}

pub(super) fn routes() -> Router<AppState> {
    Router::new().route(
        "/internal/mcp/project/update-feature",
        post(update_feature_handler),
    )
}

async fn update_feature_handler(
    State(state): State<AppState>,
    Json(body): Json<UpdateFeatureRequest>,
) -> Result<Json<UpdateFeatureResponse>, AppError> {
    handle_update_feature(state, body, WriteScope::Project).await
}

/// One update path for both scopes. Workspace scope drops the same-project
/// restriction on the target and demands the Steward grant on the source
/// instead; everything after that — snapshot, archive guard, write, broadcast,
/// audit — is identical.
pub(super) async fn handle_update_feature(
    state: AppState,
    body: UpdateFeatureRequest,
    scope: WriteScope,
) -> Result<Json<UpdateFeatureResponse>, AppError> {
    let started_at = std::time::Instant::now();
    let changes = validated_changes(&body, scope)?;
    let caller = resolve_session_scope(&state.write_pool, body.source_session_id).await?;
    if scope.allows_cross_project() {
        if let Err(refusal) =
            ensure_workspace_write_authority(&state.read_pool, caller.feature_id).await
        {
            audit_refusal(
                &state,
                &caller,
                body.feature_id,
                &refusal,
                started_at,
                scope,
            )
            .await?;
            return Err(refusal);
        }
    }
    let owning_project_id = (!scope.allows_cross_project()).then_some(caller.project_id);
    let (previous, target_project_id) =
        load_snapshot(&state.write_pool, body.feature_id, owning_project_id).await?;
    if changes.status == Some(FeatureStatus::Archived) {
        ensure_no_other_running_session(
            &state.write_pool,
            body.feature_id,
            caller.session_id,
            scope,
        )
        .await?;
    }
    apply_changes(&state.write_pool, body.feature_id, &changes).await?;

    let updated = changes.applied_to(&previous);
    notify_feature_update(&state, body.feature_id, &changes, &updated).await;
    let response = UpdateFeatureResponse {
        updated,
        previous: previous.clone(),
    };
    record_tool_audit(
        &state.write_pool,
        ToolAudit {
            server_name: scope.server_name(),
            tool_name: scope.update_feature_tool(),
            source_session_id: Some(caller.session_id),
            source_feature_id: Some(caller.feature_id),
            source_project_id: Some(caller.project_id),
            target_session_id: None,
            target_feature_id: Some(body.feature_id),
            target_project_id: Some(target_project_id),
            status: "ok",
            result_size_bytes: result_size_bytes(&response),
            latency_ms: elapsed_ms(started_at),
            error: None,
            previous_value: Some(
                serde_json::to_value(&previous)
                    .map_err(|error| AppError::Internal(error.to_string()))?,
            ),
        },
    )
    .await?;
    Ok(Json(response))
}

/// A Steward refusal is a security-boundary event, so it is journaled the same
/// way `stop_session` journals its own: nothing was written, but the attempt
/// stays visible. `previous_value` is `None` — a refused write has no state to
/// restore — and so is the target project, which only the snapshot load below
/// would have resolved.
async fn audit_refusal(
    state: &AppState,
    caller: &SessionScope,
    feature_id: i64,
    refusal: &AppError,
    started_at: std::time::Instant,
    scope: WriteScope,
) -> Result<(), AppError> {
    let error = refusal.to_string();
    record_tool_audit(
        &state.write_pool,
        ToolAudit {
            server_name: scope.server_name(),
            tool_name: scope.update_feature_tool(),
            source_session_id: Some(caller.session_id),
            source_feature_id: Some(caller.feature_id),
            source_project_id: Some(caller.project_id),
            target_session_id: None,
            target_feature_id: Some(feature_id),
            target_project_id: None,
            status: "error",
            result_size_bytes: 0,
            latency_ms: elapsed_ms(started_at),
            error: Some(&error),
            previous_value: None,
        },
    )
    .await
}

fn validated_changes(
    request: &UpdateFeatureRequest,
    scope: WriteScope,
) -> Result<FeatureChanges, AppError> {
    let title = match request.title.as_deref().map(str::trim) {
        Some("") => return Err(AppError::BadRequest("title must not be blank".to_string())),
        Some(title) => Some(title.to_string()),
        None => None,
    };
    let status = match request.status.as_deref() {
        Some("active") => Some(FeatureStatus::Active),
        Some("archived") => Some(FeatureStatus::Archived),
        Some(other) => {
            return Err(AppError::BadRequest(format!(
                "status must be 'active' or 'archived', got '{other}'"
            )))
        }
        None => None,
    };
    // A blank label is stored as absent, matching PUT /api/features/{id}/label.
    let label = request.label.clone().map(|label| {
        label
            .map(|label| label.trim().to_string())
            .filter(|label| !label.is_empty())
    });
    let changes = FeatureChanges {
        title,
        label,
        pinned: request.pinned,
        status,
    };
    if changes.is_empty() {
        return Err(AppError::coded(
            StatusCode::BAD_REQUEST,
            "EMPTY_UPDATE",
            format!(
                "{} needs at least one of title, label, pinned, or status.",
                scope.update_feature_tool()
            ),
        ));
    }
    Ok(changes)
}

#[cfg(test)]
mod tests {
    use super::{
        validated_changes as validate, FeatureChanges, FeatureState, UpdateFeatureRequest,
    };
    use crate::domain::features::models::FeatureStatus;
    use crate::domain::mcp::write_scope::WriteScope;

    fn request(body: serde_json::Value) -> UpdateFeatureRequest {
        serde_json::from_value(body).expect("update request")
    }

    fn validated_changes(
        request: &UpdateFeatureRequest,
    ) -> Result<FeatureChanges, crate::error::AppError> {
        validate(request, WriteScope::Project)
    }

    #[test]
    fn an_update_with_no_fields_is_rejected_as_empty() {
        let error = validated_changes(&request(
            serde_json::json!({"source_session_id": 777, "feature_id": 42}),
        ))
        .unwrap_err();

        assert!(matches!(
            error,
            crate::error::AppError::Coded {
                code: "EMPTY_UPDATE",
                ..
            }
        ));
    }

    /// The refusal has to name the tool the caller actually used, or a workspace
    /// steward is told to retry with a tool it never called.
    #[test]
    fn the_empty_update_refusal_names_the_calling_tool() {
        let error = validate(
            &request(serde_json::json!({"source_session_id": 777, "feature_id": 42})),
            WriteScope::Workspace,
        )
        .unwrap_err();

        assert!(matches!(
            error,
            crate::error::AppError::Coded { code: "EMPTY_UPDATE", ref message, .. }
                if message.starts_with("workspace_update_feature")
        ));
    }

    #[test]
    fn an_explicit_null_label_clears_while_an_absent_label_is_untouched() {
        let cleared = validated_changes(&request(serde_json::json!({
            "source_session_id": 777, "feature_id": 42, "label": null
        })))
        .unwrap();
        assert_eq!(cleared.label, Some(None));

        let blank = validated_changes(&request(serde_json::json!({
            "source_session_id": 777, "feature_id": 42, "label": "   "
        })))
        .unwrap();
        assert_eq!(blank.label, Some(None));

        let set = validated_changes(&request(serde_json::json!({
            "source_session_id": 777, "feature_id": 42, "label": " urgent "
        })))
        .unwrap();
        assert_eq!(set.label, Some(Some("urgent".to_string())));

        let untouched = validated_changes(&request(serde_json::json!({
            "source_session_id": 777, "feature_id": 42, "pinned": true
        })))
        .unwrap();
        assert!(untouched.label.is_none());
    }

    #[test]
    fn blank_titles_and_unknown_statuses_are_rejected() {
        for body in [
            serde_json::json!({"source_session_id": 777, "feature_id": 42, "title": "  "}),
            serde_json::json!({"source_session_id": 777, "feature_id": 42, "status": "deleted"}),
        ] {
            assert!(matches!(
                validated_changes(&request(body)).unwrap_err(),
                crate::error::AppError::BadRequest(_)
            ));
        }
    }

    #[test]
    fn unchanged_fields_are_echoed_from_the_previous_state() {
        let previous = FeatureState {
            title: "Old title".to_string(),
            label: Some("old".to_string()),
            pinned: false,
            status: "active".to_string(),
        };
        let changes = validated_changes(&request(serde_json::json!({
            "source_session_id": 777, "feature_id": 42, "status": "archived"
        })))
        .unwrap();

        let updated = changes.applied_to(&previous);

        assert_eq!(changes.status, Some(FeatureStatus::Archived));
        assert_eq!(updated.title, "Old title");
        assert_eq!(updated.label.as_deref(), Some("old"));
        assert!(!updated.pinned);
        assert_eq!(updated.status, "archived");
    }
}
