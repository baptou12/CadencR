//! HTTP surface for remote access.
//!
//! Control endpoints (status/enable/disable/pairing-code/revoke) are mounted on
//! the **loopback** router only, so a remote device can never reach them — they
//! require the launch token and run on `127.0.0.1`. The single **public**
//! endpoint, `pair`, is mounted on the remote router and authenticates via the
//! pairing code rather than a bearer token.

use axum::extract::{Path, State};
use axum::routing::{delete, get, post, put};
use axum::{Extension, Json, Router};

use super::models::{
    PairRequest, PairResponse, PairingCodeResponse, RemoteStatus, TunnelHostRequest,
};
use super::{repo, tokens};
use crate::app_state::AppState;
use crate::domain::workspace::repository;
use crate::error::AppError;
use crate::remote::{
    load_tunnel_host, sanitize_tunnel_host, RemoteContext, RemoteError, RemoteInfo,
    REMOTE_ENABLED_SETTING, REMOTE_TUNNEL_HOST_SETTING,
};

const AUDIT_TAIL_LIMIT: i64 = 50;
const DEVICE_LABEL: &str = "Remote device";

/// Loopback-only control endpoints (launch-token authenticated).
pub fn loopback_router() -> Router<AppState> {
    Router::new()
        .route("/api/remote/status", get(status_handler))
        .route("/api/remote/enable", post(enable_handler))
        .route("/api/remote/disable", post(disable_handler))
        .route("/api/remote/pairing-code", post(pairing_code_handler))
        .route("/api/remote/devices/{id}", delete(revoke_handler))
        .route("/api/remote/tunnel-host", put(set_tunnel_host_handler))
}

/// Remote-listener endpoint: exchange a pairing code for a device token.
pub fn public_router() -> Router<AppState> {
    Router::new().route("/api/remote/pair", post(pair_handler))
}

fn lan_urls(info: &RemoteInfo) -> Vec<String> {
    info.lan_ips
        .iter()
        .map(|ip| format!("https://{ip}:{}/", info.port))
        .collect()
}

/// Connect URLs that carry the pairing `code`: one per LAN interface, plus the
/// tunnel host when configured (so a device off the LAN can still pair).
async fn pairing_urls(state: &AppState, info: &RemoteInfo, code: &str) -> Vec<String> {
    let mut urls: Vec<String> = info
        .lan_ips
        .iter()
        .map(|ip| format!("https://{ip}:{}/?code={code}", info.port))
        .collect();
    if let Some(host) = load_tunnel_host(&state.read_pool).await {
        urls.push(format!("https://{host}/?code={code}"));
    }
    urls
}

async fn current_status(state: &AppState) -> Result<RemoteStatus, AppError> {
    let info = state.remote.status().await;
    let devices = repo::list_active_devices(&state.read_pool).await?;
    let audit_tail = repo::recent_audit(&state.read_pool, AUDIT_TAIL_LIMIT).await?;
    let tunnel_host = load_tunnel_host(&state.read_pool).await;
    let (port, fingerprint, lan_urls) = match &info {
        Some(info) => (
            Some(info.port),
            Some(info.fingerprint.clone()),
            lan_urls(info),
        ),
        None => (None, None, Vec::new()),
    };
    Ok(RemoteStatus {
        enabled: info.is_some(),
        port,
        fingerprint,
        lan_urls,
        tunnel_host,
        devices,
        audit_tail,
    })
}

#[utoipa::path(get, path = "/api/remote/status", responses((status = 200, body = RemoteStatus)))]
pub async fn status_handler(State(state): State<AppState>) -> Result<Json<RemoteStatus>, AppError> {
    Ok(Json(current_status(&state).await?))
}

#[utoipa::path(post, path = "/api/remote/enable", responses((status = 200, body = RemoteStatus)))]
pub async fn enable_handler(State(state): State<AppState>) -> Result<Json<RemoteStatus>, AppError> {
    state.remote.start(&state).await.map_err(|err| match err {
        RemoteError::NoRendererDir => AppError::ServiceUnavailable(err.to_string()),
        _ => AppError::Internal(err.to_string()),
    })?;
    repository::set_setting(&state.write_pool, REMOTE_ENABLED_SETTING, "true").await?;
    Ok(Json(current_status(&state).await?))
}

#[utoipa::path(post, path = "/api/remote/disable", responses((status = 200, body = RemoteStatus)))]
pub async fn disable_handler(
    State(state): State<AppState>,
) -> Result<Json<RemoteStatus>, AppError> {
    state.remote.stop().await;
    repository::set_setting(&state.write_pool, REMOTE_ENABLED_SETTING, "false").await?;
    Ok(Json(current_status(&state).await?))
}

#[utoipa::path(post, path = "/api/remote/pairing-code", responses((status = 200, body = PairingCodeResponse)))]
pub async fn pairing_code_handler(
    State(state): State<AppState>,
) -> Result<Json<PairingCodeResponse>, AppError> {
    let info = state
        .remote
        .status()
        .await
        .ok_or_else(|| AppError::Conflict("Enable remote access before pairing".into()))?;
    let minted = state.remote.pairing().mint();
    let urls = pairing_urls(&state, &info, &minted.code).await;
    Ok(Json(PairingCodeResponse {
        code: minted.code,
        expires_in_secs: minted.expires_in_secs,
        urls,
        fingerprint: info.fingerprint,
    }))
}

#[utoipa::path(
    delete,
    path = "/api/remote/devices/{id}",
    params(("id" = i64, Path, description = "Device id to revoke")),
    responses((status = 200, body = RemoteStatus))
)]
pub async fn revoke_handler(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<RemoteStatus>, AppError> {
    if !repo::revoke_device(&state.write_pool, id).await? {
        return Err(AppError::NotFound(format!("device {id}")));
    }
    repo::record_audit(&state.write_pool, "revoke", Some(id), None).await?;
    // Force-close any live sockets this device still holds.
    state.remote.live().cancel_device(id);
    Ok(Json(current_status(&state).await?))
}

#[utoipa::path(
    put,
    path = "/api/remote/tunnel-host",
    request_body = TunnelHostRequest,
    responses((status = 200, body = RemoteStatus))
)]
pub async fn set_tunnel_host_handler(
    State(state): State<AppState>,
    Json(req): Json<TunnelHostRequest>,
) -> Result<Json<RemoteStatus>, AppError> {
    let normalized = req.host.as_deref().and_then(sanitize_tunnel_host);
    repository::set_setting(
        &state.write_pool,
        REMOTE_TUNNEL_HOST_SETTING,
        normalized.as_deref().unwrap_or(""),
    )
    .await?;
    // Rebuild the listener's `Host`/`Origin` allowlist if it's running. A restart
    // is the simplest correct way to apply the new context; it briefly drops live
    // remote sessions, which is acceptable for a host-initiated config change.
    if state.remote.status().await.is_some() {
        state.remote.stop().await;
        state
            .remote
            .start(&state)
            .await
            .map_err(|err| AppError::Internal(err.to_string()))?;
    }
    Ok(Json(current_status(&state).await?))
}

#[utoipa::path(
    post,
    path = "/api/remote/pair",
    request_body = PairRequest,
    responses((status = 200, body = PairResponse), (status = 400, description = "Invalid or expired code"))
)]
pub async fn pair_handler(
    State(state): State<AppState>,
    Extension(ctx): Extension<RemoteContext>,
    Json(req): Json<PairRequest>,
) -> Result<Json<PairResponse>, AppError> {
    if !state.remote.pairing().consume(&req.code) {
        // Best-effort audit; never block the response on the audit write, but
        // surface a write failure (a rejected pairing is a security event).
        if let Err(err) = repo::record_audit(&state.write_pool, "pair_rejected", None, None).await {
            tracing::warn!(%err, "failed to record pair_rejected audit event");
        }
        return Err(AppError::BadRequest(
            "Invalid or expired pairing code".into(),
        ));
    }

    let raw = tokens::mint_raw_token();
    let hash = tokens::hash_token(&ctx.pepper, &raw);
    let id = repo::insert_device(&state.write_pool, &hash, DEVICE_LABEL).await?;
    repo::record_audit(&state.write_pool, "pair", Some(id), None).await?;

    Ok(Json(PairResponse {
        device_token: raw,
        label: DEVICE_LABEL.to_string(),
    }))
}
