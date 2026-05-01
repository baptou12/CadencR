mod event_inputs;
mod event_items;
mod event_json;
mod event_loop;
mod event_plan;
mod event_raw;
mod event_state;
mod event_system;
mod event_usage;
mod events;
mod input;
mod mcp;
mod model;
mod permission_details;
mod permissions;
mod responses;
mod session;
mod turn_start;

use std::collections::HashMap;
use std::future::Future;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use async_trait::async_trait;
use codex_app_server_sdk_rs::{AppServerSpawnOptions, CodexAppServerClient, CodexModel};
use serde_json::{json, Value};
use tokio::sync::{Mutex, RwLock};

use self::mcp::{mcp_server_names, mcp_server_statuses, thread_config};
use self::model::{approval_policy, sandbox_mode};
use self::session::CodexSession;
use super::adapter::{
    AgentRuntimeAdapter, AgentRuntimeSession, RuntimeCompactionStrategy, RuntimeError,
    RuntimePermissionRequest, RuntimeSpawnConfig,
};
use super::response_style::{rich_markdown_system_prompt, RICH_MARKDOWN_INSTRUCTION};
use super::runtime::{ModelCatalogEntry, ProviderCatalogEntry, ProviderStatus};

pub struct CodexAdapter;

pub static CODEX_ADAPTER: CodexAdapter = CodexAdapter;

pub const PROVIDER_ID: &str = "codex_cli";
const PROVIDER_LABEL: &str = "Codex CLI";
const PROBE_TIMEOUT: Duration = Duration::from_secs(3);
const CATALOG_TTL: Duration = Duration::from_secs(30);
const DEFAULT_MODE_REQUEST_USER_INPUT_FEATURE: &str = "default_mode_request_user_input";

#[derive(Clone)]
struct CatalogCacheEntry {
    fetched_at: Instant,
    catalog: ProviderCatalogEntry,
}

static CATALOG_CACHE: OnceLock<RwLock<Option<CatalogCacheEntry>>> = OnceLock::new();
static CATALOG_REFRESH_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn catalog_cache() -> &'static RwLock<Option<CatalogCacheEntry>> {
    CATALOG_CACHE.get_or_init(|| RwLock::new(None))
}

fn catalog_refresh_lock() -> &'static Mutex<()> {
    CATALOG_REFRESH_LOCK.get_or_init(|| Mutex::new(()))
}

pub(super) async fn with_timeout<T>(
    operation: &'static str,
    future: impl Future<Output = Result<T, codex_app_server_sdk_rs::SdkError>>,
) -> Result<T, RuntimeError> {
    tokio::time::timeout(PROBE_TIMEOUT, future)
        .await
        .map_err(|_| RuntimeError::new(format!("{operation} timed out")))?
        .map_err(RuntimeError::from)
}

fn catalog_from_models(models: Vec<CodexModel>) -> ProviderCatalogEntry {
    let default_model = models
        .iter()
        .find(|model| model.is_default)
        .or_else(|| models.first())
        .map(|model| model.id.clone());
    ProviderCatalogEntry {
        id: PROVIDER_ID.to_string(),
        label: PROVIDER_LABEL.to_string(),
        status: ProviderStatus::Available,
        status_message: None,
        models: models.into_iter().map(model_entry).collect(),
        default_model,
    }
}

fn unavailable_catalog(message: impl Into<String>) -> ProviderCatalogEntry {
    ProviderCatalogEntry {
        id: PROVIDER_ID.to_string(),
        label: PROVIDER_LABEL.to_string(),
        status: ProviderStatus::Unavailable,
        status_message: Some(message.into()),
        models: Vec::new(),
        default_model: None,
    }
}

fn model_entry(model: CodexModel) -> ModelCatalogEntry {
    let supported_efforts = model
        .supported_efforts
        .into_iter()
        .filter(|effort| matches!(effort.as_str(), "low" | "medium" | "high" | "xhigh"))
        .collect::<Vec<_>>();
    ModelCatalogEntry {
        id: model.id,
        label: model.label,
        description: model.description,
        supports_effort: Some(!supported_efforts.is_empty()),
        supported_effort_levels: (!supported_efforts.is_empty()).then_some(supported_efforts),
        supports_adaptive_thinking: None,
        supports_fast_mode: None,
        supports_auto_mode: None,
    }
}

async fn live_catalog() -> ProviderCatalogEntry {
    if let Some(entry) = catalog_cache().read().await.clone() {
        if entry.fetched_at.elapsed() < CATALOG_TTL {
            return entry.catalog;
        }
    }

    let _refresh = catalog_refresh_lock().lock().await;
    if let Some(entry) = catalog_cache().read().await.clone() {
        if entry.fetched_at.elapsed() < CATALOG_TTL {
            return entry.catalog;
        }
    }

    let catalog = match probe_models().await {
        Ok(models) if !models.is_empty() => catalog_from_models(models),
        Ok(_) => unavailable_catalog("codex app-server returned no models"),
        Err(error) => unavailable_catalog(format!("codex app-server unavailable: {error}")),
    };
    *catalog_cache().write().await = Some(CatalogCacheEntry {
        fetched_at: Instant::now(),
        catalog: catalog.clone(),
    });
    catalog
}

async fn probe_models() -> Result<Vec<CodexModel>, RuntimeError> {
    let client = CodexAppServerClient::spawn_with_options(app_server_spawn_options(None)).await?;
    let result = async {
        client.initialize_with_timeout(PROBE_TIMEOUT).await?;
        with_timeout("Codex model/list", client.model_list()).await
    }
    .await;
    client.shutdown().await;
    result
}

fn app_server_spawn_options(env: Option<HashMap<String, String>>) -> AppServerSpawnOptions {
    AppServerSpawnOptions {
        env,
        enable_features: vec![DEFAULT_MODE_REQUEST_USER_INPUT_FEATURE.to_string()],
        ..AppServerSpawnOptions::default()
    }
}

async fn start_or_resume_thread(
    client: &CodexAppServerClient,
    config: &RuntimeSpawnConfig,
    mcp_config: &Value,
) -> Result<String, RuntimeError> {
    match config.resume_session_id.as_deref() {
        Some(thread_id) => Ok(with_timeout(
            "Codex thread/resume",
            client.thread_resume(thread_resume_params(thread_id, config, mcp_config)),
        )
        .await?
        .id),
        None => start_thread(client, config, mcp_config).await,
    }
}

async fn start_thread(
    client: &CodexAppServerClient,
    config: &RuntimeSpawnConfig,
    mcp_config: &Value,
) -> Result<String, RuntimeError> {
    Ok(with_timeout(
        "Codex thread/start",
        client.thread_start(thread_start_params(config, mcp_config)),
    )
    .await?
    .id)
}

fn thread_start_params(config: &RuntimeSpawnConfig, mcp_config: &Value) -> Value {
    let mut params = base_thread_params(config);
    params["experimentalRawEvents"] = Value::Bool(true);
    params["persistExtendedHistory"] = Value::Bool(true);
    if !mcp_config.is_null() {
        params["config"] = mcp_config.clone();
    }
    params
}

fn thread_resume_params(thread_id: &str, config: &RuntimeSpawnConfig, mcp_config: &Value) -> Value {
    let mut params = base_thread_params(config);
    params["threadId"] = Value::String(thread_id.to_string());
    if !mcp_config.is_null() {
        params["config"] = mcp_config.clone();
    }
    params
}

fn base_thread_params(config: &RuntimeSpawnConfig) -> Value {
    let mut params = json!({
        "cwd": config.cwd.to_string_lossy(),
        "approvalPolicy": approval_policy(config.permission_mode.as_ref()),
        // `thread/start` takes the shorthand sandbox mode, while per-turn
        // overrides use `sandboxPolicy`.
        "sandbox": sandbox_mode(config.permission_mode.as_ref()),
    });
    if let Some(model) = config.model.as_ref() {
        params["model"] = Value::String(model.clone());
    }
    params["baseInstructions"] =
        Value::String(rich_markdown_system_prompt(config.system_prompt.as_deref()));
    params
}

#[async_trait]
impl AgentRuntimeAdapter for CodexAdapter {
    fn parse_permission_request(&self, raw: &Value) -> Option<RuntimePermissionRequest> {
        permissions::parse_permission_request(raw)
    }

    fn accepts_model(&self, model: &str) -> bool {
        self::model::accepts_model(model)
    }

    fn catalog_entry(&self) -> ProviderCatalogEntry {
        unavailable_catalog("Codex availability has not been checked yet")
    }

    async fn catalog_entry_live(&self) -> ProviderCatalogEntry {
        live_catalog().await
    }

    async fn default_model_id(&self) -> Option<String> {
        live_catalog().await.default_model
    }

    fn spawn_startup_warmup(&self) {
        tokio::spawn(async {
            let _ = live_catalog().await;
        });
    }

    fn compaction_strategy(&self) -> Option<RuntimeCompactionStrategy> {
        Some(RuntimeCompactionStrategy::LiveRuntime)
    }

    async fn spawn(
        &self,
        content: Value,
        config: RuntimeSpawnConfig,
    ) -> Result<Box<dyn AgentRuntimeSession>, RuntimeError> {
        let client =
            CodexAppServerClient::spawn_with_options(app_server_spawn_options(config.env.clone()))
                .await?;
        client.initialize_with_timeout(PROBE_TIMEOUT).await?;
        let event_rx = client.subscribe();
        let mcp_config =
            thread_config(config.mcp_servers.as_ref(), Some(RICH_MARKDOWN_INSTRUCTION));
        let mcp_server_names = mcp_server_names(&mcp_config);
        let thread_id = start_or_resume_thread(&client, &config, &mcp_config).await?;
        let mcp_servers = mcp_server_statuses(&client, &mcp_server_names).await;
        let session = CodexSession::new(
            client,
            thread_id,
            config.model,
            config.thinking_effort,
            config.permission_mode,
            config.cwd,
            event_rx,
            mcp_servers,
            None,
        );
        session.send_init_event().await;
        session.start_initial_turn(content).await?;
        Ok(Box::new(session))
    }
}

#[cfg(test)]
mod tests {
    use super::{app_server_spawn_options, thread_config, thread_resume_params, CodexAdapter};
    use crate::domain::agents::adapter::{
        AgentRuntimeAdapter, RuntimePermissionMode, RuntimeSpawnConfig,
    };
    use crate::domain::agents::response_style::{
        rich_markdown_system_prompt, RICH_MARKDOWN_INSTRUCTION,
    };
    use serde_json::json;
    use std::collections::HashMap;
    use std::path::PathBuf;

    #[test]
    fn accepts_bare_codex_and_gpt_models() {
        let adapter = CodexAdapter;
        assert!(adapter.accepts_model("gpt-5.4"));
        assert!(adapter.accepts_model("codex-mini"));
        assert!(!adapter.accepts_model("openai/gpt-5.4"));
    }

    #[test]
    fn enables_request_user_input_in_default_mode() {
        let options = app_server_spawn_options(None);
        assert!(options
            .enable_features
            .contains(&"default_mode_request_user_input".to_string()));
    }

    #[test]
    fn resume_params_keep_thread_overrides_and_mcp_config() {
        let config = RuntimeSpawnConfig {
            cwd: PathBuf::from("/tmp/project"),
            permission_mode: Some(RuntimePermissionMode::AcceptEdits),
            model: Some("gpt-5.5".to_string()),
            system_prompt: Some("Be useful".to_string()),
            ..RuntimeSpawnConfig::default()
        };
        let params = thread_resume_params(
            "thread-1",
            &config,
            &thread_config(
                Some(&HashMap::from([(
                    "cadence-plan".to_string(),
                    crate::domain::agents::adapter::RuntimeMcpServerConfig::Stdio {
                        command: "svc".to_string(),
                        args: None,
                        env: None,
                    },
                )])),
                Some(RICH_MARKDOWN_INSTRUCTION),
            ),
        );

        assert_eq!(params["threadId"], json!("thread-1"));
        assert_eq!(params["cwd"], json!("/tmp/project"));
        assert_eq!(params["model"], json!("gpt-5.5"));
        assert!(params["baseInstructions"]
            .as_str()
            .expect("base instructions")
            .starts_with(RICH_MARKDOWN_INSTRUCTION));
        assert!(params["baseInstructions"]
            .as_str()
            .expect("base instructions")
            .ends_with("Be useful"));
        assert_eq!(
            params["config"]["developer_instructions"],
            json!(RICH_MARKDOWN_INSTRUCTION)
        );
        assert_eq!(
            params["config"]["mcp_servers"]["cadence-plan"]["command"],
            json!("svc")
        );
        assert!(params.get("approvalPolicy").is_some());
        assert!(params.get("sandbox").is_some());
    }

    #[test]
    fn base_thread_params_uses_markdown_instruction_without_base_prompt() {
        assert_eq!(rich_markdown_system_prompt(None), RICH_MARKDOWN_INSTRUCTION);
    }
}
