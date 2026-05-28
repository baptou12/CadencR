//! Orchestration layer: list importable conversations and persist them as
//! `features` + `agent_sessions` + `agent_messages`. Pure DB work goes
//! through sqlx; provider parsing is delegated to `claude_code_jsonl`.

use std::collections::HashSet;
use std::path::PathBuf;

use sqlx::SqlitePool;

use crate::error::AppError;

use super::claude_code_jsonl::{
    claude_projects_dir_for, list_session_files, parse_session_file, ImportedConversation,
};
use super::models::{
    ImportConversationSummary, ImportedRecord, SkipReason, SkippedRecord, PROVIDER_CLAUDE_CODE,
};

/// Look up a project's filesystem `path`. The caller uses it to derive the
/// `~/.claude/projects/<encoded>/` directory.
pub async fn project_path(pool: &SqlitePool, project_id: i64) -> Result<String, AppError> {
    let row: Option<(String,)> = sqlx::query_as("SELECT path FROM projects WHERE id = ?")
        .bind(project_id)
        .fetch_optional(pool)
        .await?;
    row.map(|r| r.0)
        .ok_or_else(|| AppError::NotFound(format!("project {project_id} not found")))
}

/// Source session UUIDs already imported into a project for a given provider.
/// The provenance lives on `agent_sessions.(runtime_provider, runtime_session_id)` —
/// we don't shadow it onto `features`, so this is a join, not a column read.
pub async fn already_imported_ids(
    pool: &SqlitePool,
    project_id: i64,
    provider: &str,
) -> Result<HashSet<String>, AppError> {
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT DISTINCT s.runtime_session_id
         FROM features f
         JOIN agent_sessions s ON s.feature_id = f.id
         WHERE f.project_id = ?
           AND s.runtime_provider = ?
           AND s.runtime_session_id IS NOT NULL",
    )
    .bind(project_id)
    .bind(provider)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|(s,)| s).collect())
}

/// List Claude Code conversations available for a project, with the
/// `already_imported` flag derived from the DB. Missing on-disk directory
/// yields an empty list — that's the expected "no history yet" state.
/// The filesystem scan + per-file JSON parsing runs on a blocking worker so
/// it doesn't stall the request executor.
pub async fn list_claude_code_conversations(
    pool: &SqlitePool,
    project_id: i64,
) -> Result<Vec<ImportConversationSummary>, AppError> {
    let project_path_str = project_path(pool, project_id).await?;
    let imported = already_imported_ids(pool, project_id, PROVIDER_CLAUDE_CODE).await?;
    let parsed = tokio::task::spawn_blocking(move || scan_claude_code_dir(&project_path_str))
        .await
        .map_err(|e| AppError::Internal(format!("scan task panicked: {e}")))??;
    let mut out: Vec<ImportConversationSummary> = parsed
        .into_iter()
        .map(|conv| ImportConversationSummary {
            already_imported: imported.contains(&conv.source_session_id),
            source_session_id: conv.source_session_id,
            title: conv.title,
            message_count: conv.message_count,
            modified_at: conv.modified_at,
        })
        .collect();
    out.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
    Ok(out)
}

/// Synchronous file-scan half of [`list_claude_code_conversations`]. Kept
/// separate so it can be wrapped in `spawn_blocking` without contaminating
/// the async signature.
fn scan_claude_code_dir(project_path: &str) -> Result<Vec<ImportedConversation>, AppError> {
    let Some(dir) = claude_projects_dir_for(&PathBuf::from(project_path)) else {
        return Ok(Vec::new());
    };
    let files = list_session_files(&dir)
        .map_err(|e| AppError::Internal(format!("read {}: {e}", dir.display())))?;
    let mut out = Vec::with_capacity(files.len());
    for path in files {
        match parse_session_file(&path) {
            Ok(Some(c)) => out.push(c),
            Ok(None) => {}
            Err(err) => tracing::warn!(
                file = %path.display(),
                error = %err,
                "failed to parse Claude Code JSONL — skipping"
            ),
        }
    }
    Ok(out)
}

/// Outcome of importing a single conversation.
pub enum ImportOutcome {
    Imported(ImportedRecord),
    Skipped(SkippedRecord),
}

/// Result of loading a single Claude Code session off disk. Bundled so the
/// importer can map "file gone" vs "file present but empty" to distinct
/// skip reasons.
enum LoadedSession {
    Found(ImportedConversation),
    NotFound,
    Empty,
}

/// Load + persist a single source session by id. Bundles disk read with the
/// DB write so the route handler stays a thin shim and the layering matches
/// "input is a session id, output is an outcome".
pub async fn import_session_by_id(
    write_pool: &SqlitePool,
    project_id: i64,
    project_path: &str,
    source_session_id: &str,
) -> Result<ImportOutcome, AppError> {
    let project_path = project_path.to_string();
    let session_id = source_session_id.to_string();
    let loaded = tokio::task::spawn_blocking(move || {
        load_claude_code_conversation(&project_path, &session_id)
    })
    .await
    .map_err(|e| AppError::Internal(format!("load task panicked: {e}")))?;
    let skip = |reason: SkipReason| {
        Ok(ImportOutcome::Skipped(SkippedRecord {
            source_session_id: source_session_id.to_string(),
            reason,
        }))
    };
    match loaded {
        Ok(LoadedSession::Found(c)) => import_one(write_pool, project_id, c).await,
        Ok(LoadedSession::NotFound) => skip(SkipReason::NotFound),
        Ok(LoadedSession::Empty) => skip(SkipReason::Empty),
        Err(err) => {
            tracing::warn!(error = %err, "failed to parse Claude Code session for import");
            skip(SkipReason::ParseError)
        }
    }
}

/// Persist a single parsed conversation. Wraps the inserts in one
/// transaction so a partial failure leaves the DB clean. Re-import dedup is
/// a pre-check inside the tx — provenance lives on the `agent_sessions`
/// row, not on a redundant column on `features`.
pub async fn import_one(
    write_pool: &SqlitePool,
    project_id: i64,
    conv: ImportedConversation,
) -> Result<ImportOutcome, AppError> {
    let mut tx = write_pool.begin().await?;

    let existing: Option<(i64,)> = sqlx::query_as(
        "SELECT s.id
         FROM features f
         JOIN agent_sessions s ON s.feature_id = f.id
         WHERE f.project_id = ?
           AND s.runtime_provider = ?
           AND s.runtime_session_id = ?
         LIMIT 1",
    )
    .bind(project_id)
    .bind(PROVIDER_CLAUDE_CODE)
    .bind(&conv.source_session_id)
    .fetch_optional(&mut *tx)
    .await?;
    if existing.is_some() {
        return Ok(ImportOutcome::Skipped(SkippedRecord {
            source_session_id: conv.source_session_id,
            reason: SkipReason::AlreadyImported,
        }));
    }

    let feature_result = sqlx::query(
        "INSERT INTO features (project_id, title, status, type) VALUES (?, ?, 'active', 'ws-session')",
    )
    .bind(project_id)
    .bind(&conv.title)
    .execute(&mut *tx)
    .await?;
    let feature_id = feature_result.last_insert_rowid();

    // Schema dropped `claude_session_id` in 20260413120000 in favor of the
    // provider-neutral (runtime_provider, runtime_session_id) pair — this
    // row is also the provenance record the dedup join reads.
    let session_result = sqlx::query(
        "INSERT INTO agent_sessions (feature_id, agent_type, runtime_provider, runtime_session_id, status, started_at, ended_at) VALUES (?, 'session', ?, ?, 'completed', ?, ?)",
    )
    .bind(feature_id)
    .bind(PROVIDER_CLAUDE_CODE)
    .bind(&conv.source_session_id)
    .bind(conv.started_at.as_deref().or(conv.modified_at.as_deref()))
    .bind(conv.modified_at.as_deref())
    .execute(&mut *tx)
    .await?;
    let session_id = session_result.last_insert_rowid();

    for msg in conv.messages.iter() {
        sqlx::query(
            "INSERT INTO agent_messages (session_id, role, content, message_type, tool_name, tool_use_id, parent_tool_use_id, model, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))",
        )
        .bind(session_id)
        .bind(&msg.role)
        .bind(&msg.content)
        .bind(&msg.message_type)
        .bind(msg.tool_name.as_deref())
        .bind(msg.tool_use_id.as_deref())
        .bind(None::<&str>) // parent_tool_use_id: top-level imports have no parent.
        .bind(msg.model.as_deref())
        .bind(msg.created_at.as_deref())
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(ImportOutcome::Imported(ImportedRecord {
        source_session_id: conv.source_session_id,
        feature_id,
    }))
}

/// Load a single conversation from disk by `(project_path, session_id)`.
/// `NotFound` covers both "no home dir" and "no file on disk"; `Empty`
/// signals the file existed but had no user/assistant messages. Parse / IO
/// errors bubble so the caller can mark the session `Skipped(ParseError)`.
fn load_claude_code_conversation(
    project_path: &str,
    source_session_id: &str,
) -> std::io::Result<LoadedSession> {
    let Some(dir) = claude_projects_dir_for(&PathBuf::from(project_path)) else {
        return Ok(LoadedSession::NotFound);
    };
    let file_path = dir.join(format!("{source_session_id}.jsonl"));
    if !file_path.exists() {
        return Ok(LoadedSession::NotFound);
    }
    Ok(match parse_session_file(&file_path)? {
        Some(c) => LoadedSession::Found(c),
        None => LoadedSession::Empty,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::imports::claude_code_jsonl::ImportedMessage;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn setup_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query(
            "CREATE TABLE projects (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, path TEXT NOT NULL)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "CREATE TABLE features (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'active',
                type TEXT NOT NULL DEFAULT 'ws-session'
            )",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "CREATE TABLE agent_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                feature_id INTEGER NOT NULL,
                agent_type TEXT NOT NULL,
                runtime_provider TEXT,
                runtime_session_id TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                started_at TEXT,
                ended_at TEXT
            )",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "CREATE TABLE agent_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                message_type TEXT NOT NULL DEFAULT 'text',
                tool_name TEXT,
                tool_use_id TEXT,
                parent_tool_use_id TEXT,
                model TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO projects (id, name, path) VALUES (1, 'p', '/tmp/p')")
            .execute(&pool)
            .await
            .unwrap();
        pool
    }

    fn sample_conv(id: &str) -> ImportedConversation {
        ImportedConversation {
            source_session_id: id.to_string(),
            title: "Hello".to_string(),
            message_count: 2,
            started_at: Some("2026-05-26T00:00:00Z".to_string()),
            modified_at: Some("2026-05-27T00:00:00Z".to_string()),
            messages: vec![
                ImportedMessage {
                    role: "user".into(),
                    content: "hi".into(),
                    message_type: "text".into(),
                    tool_name: None,
                    tool_use_id: None,
                    model: None,
                    created_at: None,
                },
                ImportedMessage {
                    role: "assistant".into(),
                    content: "hello".into(),
                    message_type: "text".into(),
                    tool_name: None,
                    tool_use_id: None,
                    model: Some("claude".into()),
                    created_at: None,
                },
            ],
        }
    }

    #[tokio::test]
    async fn import_one_creates_feature_session_and_messages() {
        let pool = setup_pool().await;
        let out = import_one(&pool, 1, sample_conv("s1")).await.unwrap();
        match out {
            ImportOutcome::Imported(r) => assert_eq!(r.source_session_id, "s1"),
            ImportOutcome::Skipped(_) => panic!("expected import"),
        }
        let count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM agent_messages WHERE session_id = 1")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(count, 2);
        let (started, ended): (String, String) =
            sqlx::query_as("SELECT started_at, ended_at FROM agent_sessions WHERE id = 1")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(started, "2026-05-26T00:00:00Z");
        assert_eq!(ended, "2026-05-27T00:00:00Z");
    }

    #[tokio::test]
    async fn import_one_skips_duplicate_session() {
        let pool = setup_pool().await;
        import_one(&pool, 1, sample_conv("s1")).await.unwrap();
        let out = import_one(&pool, 1, sample_conv("s1")).await.unwrap();
        match out {
            ImportOutcome::Skipped(s) => {
                assert!(matches!(s.reason, SkipReason::AlreadyImported));
            }
            ImportOutcome::Imported(_) => panic!("expected skip"),
        }
    }

    #[tokio::test]
    async fn already_imported_ids_returns_inserted_session() {
        let pool = setup_pool().await;
        import_one(&pool, 1, sample_conv("s1")).await.unwrap();
        let ids = already_imported_ids(&pool, 1, PROVIDER_CLAUDE_CODE)
            .await
            .unwrap();
        assert!(ids.contains("s1"));
    }
}
