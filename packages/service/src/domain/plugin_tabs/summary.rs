//! Assemble the `PluginTabSummary` the host API returns for each tab.

use std::collections::HashMap;

use cadencr_plugin_core::tab::{TabAccessLevel, TabManifest};
use sqlx::SqlitePool;

use super::models::{PluginTabEnablement, PluginTabNetwork, PluginTabStatus, PluginTabSummary};
use super::registry::{self, LocalTab};
use super::{consent, enablement, workspace};
use crate::error::AppError;

/// Every local tab, with enablement as seen from `project_id` (global only when
/// `None`). The folder scan and the three tables are each read once.
pub async fn list(
    pool: &SqlitePool,
    project_id: Option<i64>,
) -> Result<Vec<PluginTabSummary>, AppError> {
    let (tabs, projects, mut stored, consents) = tokio::try_join!(
        registry::list(),
        authoring_projects(pool),
        enablement::stored_all(pool, project_id),
        consent::consented_all(pool),
    )?;
    Ok(tabs
        .into_iter()
        .map(|tab| {
            let stored = stored.remove(&tab.id).unwrap_or_default();
            let consented = consents.get(&tab.id).map(String::as_str);
            let enablement = enablement::from_stored(&tab, stored, consented);
            let authoring = projects.get(&tab.id).copied();
            build(tab, enablement, authoring)
        })
        .collect())
}

/// One tab by id.
pub async fn get(
    pool: &SqlitePool,
    id: &str,
    project_id: Option<i64>,
) -> Result<PluginTabSummary, AppError> {
    from_tab(pool, registry::get(id).await?, project_id).await
}

/// The summary of a tab the caller already inspected.
pub async fn from_tab(
    pool: &SqlitePool,
    tab: LocalTab,
    project_id: Option<i64>,
) -> Result<PluginTabSummary, AppError> {
    let enablement = enablement::resolve(pool, &tab, project_id).await?;
    let authoring = workspace::owner_project(pool, &tab.id).await?;
    Ok(build(tab, enablement, authoring))
}

fn build(
    tab: LocalTab,
    enablement: PluginTabEnablement,
    authoring_project_id: Option<i64>,
) -> PluginTabSummary {
    let status = if tab.valid_manifest().is_some() {
        PluginTabStatus::Valid
    } else {
        PluginTabStatus::Invalid
    };
    let managed = tab.is_managed();
    let report = tab.report;
    let manifest = report.manifest.as_ref();
    let name = manifest.map_or_else(|| tab.id.clone(), |manifest| manifest.name.clone());
    PluginTabSummary {
        managed: managed.then_some(true),
        label: manifest.map_or_else(|| name.clone(), |manifest| manifest.label().to_string()),
        version: manifest.map(|manifest| manifest.version.clone()),
        description: manifest.and_then(|manifest| manifest.description.clone()),
        api_version: manifest.map(|manifest| manifest.api_version),
        entry: manifest.map(|manifest| manifest.entry.clone()),
        permissions: manifest
            .map(|manifest| manifest.permissions.clone())
            .unwrap_or_default(),
        network: manifest
            .and_then(|manifest| manifest.network.as_ref())
            .map(|network| PluginTabNetwork {
                allowed_origins: network.allowed_origins.clone(),
                reasoning: network.reasoning.clone(),
            })
            .unwrap_or_default(),
        configuration: manifest
            .map(|manifest| manifest.configuration.clone())
            .unwrap_or_default(),
        commands: manifest
            .map(|manifest| manifest.commands.clone())
            .unwrap_or_default(),
        backend: manifest.and_then(|manifest| manifest.backend.clone()),
        access_level: manifest.map_or(TabAccessLevel::Ui, TabManifest::access_level),
        name,
        icon_svg: report.icon_svg,
        entry_present: report.entry_present,
        permissions_hash: manifest.map(|manifest| manifest.permissions_hash()),
        status,
        errors: report.findings.errors,
        warnings: report.findings.warnings,
        dir: report.directory.to_string_lossy().into_owned(),
        authoring_project_id,
        enablement,
        id: tab.id,
    }
}

/// `plugin_id → project id` for every tab authoring project.
async fn authoring_projects(pool: &SqlitePool) -> Result<HashMap<String, i64>, AppError> {
    let rows: Vec<(String, i64)> = sqlx::query_as(
        "SELECT plugin_id, id FROM projects WHERE authoring_target = 'tab' AND plugin_id IS NOT NULL",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::plugin_tabs::models;
    use crate::domain::plugin_tabs::test_support::{pool, write_tab};

    #[tokio::test]
    async fn summarizes_valid_and_unreadable_tabs() {
        let pool = pool().await;
        write_tab("graph", serde_json::json!({}));
        let broken = crate::domain::plugin_tabs::paths::tabs_dir().join("broken");
        std::fs::create_dir_all(&broken).unwrap();
        std::fs::write(broken.join("tab.json"), "{").unwrap();

        let summaries = list(&pool, None).await.unwrap();
        assert_eq!(summaries.len(), 2);
        let broken = &summaries[0];
        assert_eq!(
            (broken.id.as_str(), broken.name.as_str()),
            ("broken", "broken")
        );
        assert_eq!(broken.status, PluginTabStatus::Invalid);
        assert!(broken.permissions_hash.is_none());
        let graph = &summaries[1];
        assert_eq!(graph.status, PluginTabStatus::Valid);
        assert_eq!(graph.label, "Graph");
        assert_eq!(graph.permissions, ["features:read", "git:read"]);
        assert_eq!(graph.access_level, models::TabAccessLevel::Ui);
        assert!(graph.commands.is_empty() && graph.backend.is_none());
        assert!(graph.enablement.consent_required && !graph.enablement.effective);
        assert_eq!(graph.authoring_project_id, None);
        assert_eq!(get(&pool, "graph", Some(1)).await.unwrap().id, "graph");
    }
}
