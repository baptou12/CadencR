use std::collections::{HashMap, HashSet};
use std::time::{Duration, Instant};

use futures::{stream, StreamExt};
use tracing::{info, warn};

use super::auth::{host_configs, resolve_credentials};
use super::provider::{
    CiRollup, ForgeContext, ForgeError, ForgeHostConfig, ForgeProvider, PrState, PrStatusSnapshot,
    PrSummary,
};
use super::repository::{active_feature_targets, FeatureForgeTarget};
use super::{api_base_url, effective_kind, provider_for};
use crate::app_state::AppState;
use crate::domain::git::host::{GitHost, RemoteInfo};
use crate::domain::git::refs::normalize_branch_identity;
use crate::error::AppError;

const POLL_INTERVAL: Duration = Duration::from_secs(60);
const RUNNING_CI_POLL_INTERVAL: Duration = Duration::from_secs(30);
const BITBUCKET_POLL_INTERVAL: Duration = Duration::from_secs(120);

#[derive(Clone, Hash, PartialEq, Eq)]
struct RepoKey {
    hostname: String,
    api_base_url: String,
    owner: String,
    repo: String,
    kind: GitHost,
}

struct RepoGroup {
    key: RepoKey,
    remote: RemoteInfo,
    kind: GitHost,
    config: Option<ForgeHostConfig>,
    features: Vec<(i64, String)>,
}

pub fn spawn(state: AppState) {
    info!("starting forge PR status poller");
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(RUNNING_CI_POLL_INTERVAL);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        let mut last_polled = HashMap::new();
        loop {
            ticker.tick().await;
            if let Err(error) = refresh(&state, false, &mut last_polled).await {
                warn!(%error, "forge PR status refresh failed");
            }
        }
    });
}

pub async fn refresh_all(state: &AppState) -> Result<(), AppError> {
    let mut last_polled = HashMap::new();
    refresh(state, true, &mut last_polled).await
}

async fn refresh(
    state: &AppState,
    force: bool,
    last_polled: &mut HashMap<RepoKey, Instant>,
) -> Result<(), AppError> {
    let _refresh_guard = state.forge_status.refresh_lock.lock().await;
    if !force && !state.forge_activity.has_visible_clients().await {
        return Ok(());
    }
    let targets = active_feature_targets(state).await?;
    let active_ids = targets
        .iter()
        .map(|target| target.feature_id)
        .collect::<HashSet<_>>();
    let configs = host_configs()?;
    let mut groups = HashMap::<RepoKey, RepoGroup>::new();

    for target in targets {
        if let Some(snapshot) = target_without_repo_snapshot(&target) {
            publish(state, snapshot).await;
            continue;
        }
        let remote = target.remote.expect("target checked above");
        let branch = target.branch.expect("target checked above");
        let config = configs.get(&remote.hostname).cloned();
        let kind = effective_kind(remote.host, config.as_ref());
        let api = api_base_url(&remote.hostname, kind, config.as_ref()).unwrap_or_default();
        let key = RepoKey {
            hostname: remote.hostname.clone(),
            api_base_url: api,
            owner: remote.owner.clone(),
            repo: remote.repo.clone(),
            kind,
        };
        groups
            .entry(key.clone())
            .or_insert_with(|| RepoGroup {
                key,
                remote,
                kind,
                config,
                features: Vec::new(),
            })
            .features
            .push((target.feature_id, branch));
    }

    let mut due = Vec::new();
    for group in groups.into_values() {
        if !should_poll(state, &group, force, last_polled).await {
            continue;
        }
        last_polled.insert(group.key.clone(), Instant::now());
        due.push(group);
    }
    stream::iter(due)
        .for_each_concurrent(4, |group| refresh_group(state, group))
        .await;
    state.forge_status.retain_features(&active_ids).await;
    Ok(())
}

fn target_without_repo_snapshot(target: &FeatureForgeTarget) -> Option<PrStatusSnapshot> {
    let fetched_at = chrono::Utc::now().timestamp_millis();
    if let Some(error) = &target.error {
        return Some(PrStatusSnapshot {
            feature_id: target.feature_id,
            pr: None,
            ci: None,
            fetched_at,
            error: Some(error.clone()),
            auth_required: false,
        });
    }
    if target.remote.is_none() {
        return Some(PrStatusSnapshot {
            feature_id: target.feature_id,
            pr: None,
            ci: None,
            fetched_at,
            error: None,
            auth_required: false,
        });
    }
    if target.branch.is_none() {
        return Some(PrStatusSnapshot {
            feature_id: target.feature_id,
            pr: None,
            ci: None,
            fetched_at,
            error: Some("Could not determine the feature branch".into()),
            auth_required: false,
        });
    }
    None
}

async fn should_poll(
    state: &AppState,
    group: &RepoGroup,
    force: bool,
    last_polled: &HashMap<RepoKey, Instant>,
) -> bool {
    if force {
        return true;
    }
    let interval = poll_interval(state, group).await;
    last_polled
        .get(&group.key)
        .is_none_or(|last| last.elapsed() >= interval)
}

async fn poll_interval(state: &AppState, group: &RepoGroup) -> Duration {
    if group.kind == GitHost::Bitbucket {
        return BITBUCKET_POLL_INTERVAL;
    }
    for (feature_id, _) in &group.features {
        if state
            .forge_status
            .get(*feature_id)
            .await
            .and_then(|snapshot| snapshot.ci)
            .is_some_and(|ci| ci.state == super::provider::CiState::Running)
        {
            return RUNNING_CI_POLL_INTERVAL;
        }
    }
    POLL_INTERVAL
}

async fn refresh_group(state: &AppState, group: RepoGroup) {
    let Some(provider) = provider_for(group.kind) else {
        publish_group_error(
            state,
            &group,
            "Choose a forge kind for this remote in Settings".into(),
            false,
        )
        .await;
        return;
    };
    let api_base_url = match api_base_url(&group.remote.hostname, group.kind, group.config.as_ref())
    {
        Some(url) => url,
        None => {
            publish_group_error(
                state,
                &group,
                "Configure an API base URL for this forge".into(),
                false,
            )
            .await;
            return;
        }
    };
    let credentials = match resolve_credentials(
        &state.forge_auth,
        &group.remote.hostname,
        group.kind,
        group.config.as_ref(),
    )
    .await
    {
        Ok(Some(credentials)) => credentials,
        Ok(None) => {
            publish_group_error(state, &group, String::new(), true).await;
            return;
        }
        Err(error) => {
            publish_group_error(state, &group, error.to_string(), false).await;
            return;
        }
    };
    let context = ForgeContext {
        remote: group.remote.clone(),
        api_base_url,
        credentials,
        http: state.forge_http.clone(),
    };
    let prs = match provider.list_open_prs(&context).await {
        Ok(prs) => prs,
        Err(error) => {
            publish_group_error(state, &group, error.to_string(), false).await;
            return;
        }
    };
    let mut matches = matched_prs(&group, &prs);
    let detail_errors = restore_known_prs(state, &group, provider, &context, &mut matches).await;
    let unique_prs = matches
        .values()
        .flatten()
        .filter(|pr| matches!(pr.state, PrState::Open | PrState::Draft))
        .map(|pr| (pr.number, pr.clone()))
        .collect::<HashMap<_, _>>();
    let ci_by_pr = stream::iter(unique_prs.into_values())
        .map(|pr| {
            let context = &context;
            async move {
                let number = pr.number;
                (number, provider.ci_rollup(context, &pr).await)
            }
        })
        .buffer_unordered(4)
        .collect::<HashMap<u64, Result<CiRollup, ForgeError>>>()
        .await;
    let fetched_at = chrono::Utc::now().timestamp_millis();
    for (feature_id, _) in &group.features {
        let pr = matches.get(feature_id).cloned().flatten();
        let (ci, ci_error) = match pr.as_ref().and_then(|pr| ci_by_pr.get(&pr.number)) {
            Some(Ok(ci)) => (Some(ci.clone()), None),
            Some(Err(error)) => (None, Some(error.to_string())),
            None => (None, None),
        };
        publish(
            state,
            PrStatusSnapshot {
                feature_id: *feature_id,
                pr,
                ci,
                fetched_at,
                error: detail_errors.get(feature_id).cloned().or(ci_error),
                auth_required: false,
            },
        )
        .await;
    }
}

struct KnownPr {
    previous: PrSummary,
    feature_ids: Vec<i64>,
}

async fn restore_known_prs(
    state: &AppState,
    group: &RepoGroup,
    provider: &dyn ForgeProvider,
    context: &ForgeContext,
    matches: &mut HashMap<i64, Option<PrSummary>>,
) -> HashMap<i64, String> {
    let mut candidates = HashMap::<u64, KnownPr>::new();
    for (feature_id, branch) in &group.features {
        if matches.get(feature_id).is_some_and(Option::is_some) {
            continue;
        }
        let Some(previous) = state
            .forge_status
            .get(*feature_id)
            .await
            .and_then(|status| status.pr)
            .filter(|pr| {
                normalize_branch_identity(&pr.source_branch) == normalize_branch_identity(branch)
            })
        else {
            continue;
        };
        if matches!(previous.state, PrState::Merged | PrState::Closed) {
            matches.insert(*feature_id, Some(previous));
            continue;
        }
        candidates
            .entry(previous.number)
            .and_modify(|candidate| candidate.feature_ids.push(*feature_id))
            .or_insert_with(|| KnownPr {
                previous,
                feature_ids: vec![*feature_id],
            });
    }

    let results = stream::iter(candidates.into_values())
        .map(|candidate| async move {
            let result = provider.get_pr(context, candidate.previous.number).await;
            (candidate, result)
        })
        .buffer_unordered(4)
        .collect::<Vec<_>>()
        .await;
    let mut errors = HashMap::new();
    for (candidate, result) in results {
        match result {
            Ok(pr) => {
                for feature_id in candidate.feature_ids {
                    matches.insert(feature_id, Some(pr.clone()));
                }
            }
            Err(error) => {
                for feature_id in candidate.feature_ids {
                    matches.insert(feature_id, Some(candidate.previous.clone()));
                    errors.insert(feature_id, error.to_string());
                }
            }
        }
    }
    errors
}

fn matched_prs(group: &RepoGroup, prs: &[PrSummary]) -> HashMap<i64, Option<PrSummary>> {
    group
        .features
        .iter()
        .map(|(feature_id, branch)| {
            let branch = normalize_branch_identity(branch);
            let matched = prs
                .iter()
                .filter(|pr| normalize_branch_identity(&pr.source_branch) == branch)
                .max_by(|left, right| left.updated_at.cmp(&right.updated_at))
                .cloned();
            (*feature_id, matched)
        })
        .collect()
}

async fn publish_group_error(
    state: &AppState,
    group: &RepoGroup,
    error: String,
    auth_required: bool,
) {
    let fetched_at = chrono::Utc::now().timestamp_millis();
    for (feature_id, _) in &group.features {
        publish(
            state,
            PrStatusSnapshot {
                feature_id: *feature_id,
                pr: None,
                ci: None,
                fetched_at,
                error: (!error.is_empty()).then(|| error.clone()),
                auth_required,
            },
        )
        .await;
    }
}

async fn publish(state: &AppState, snapshot: PrStatusSnapshot) {
    if state.forge_status.upsert(snapshot.clone()).await {
        let _ = state.forge_events_tx.send(snapshot);
    }
}
