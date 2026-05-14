use cadencr_service::domain::mcp::servers::{mcp_server_name, AgentType};

/// Verify mcp_server_name returns the canonical `cadencr-session` prefix.
#[test]
fn test_mcp_server_name_session() {
    assert_eq!(mcp_server_name(AgentType::Session), "cadencr-session");
}

/// Verify that the MCP stdio server responds to initialize + tools/list.
///
/// Spawns the cadencr-service binary in mcp-serve mode and verifies the
/// handshake and tool listing works end-to-end for the surviving `session`
/// agent type.
#[tokio::test]
async fn test_mcp_stdio_server_responds_to_tools_list() {
    use std::process::Stdio;
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    use tokio::process::Command;

    let tmp = tempfile::TempDir::new().unwrap();
    let db_path = tmp.path().join("test.db");
    let db_url = format!("sqlite:{}?mode=rwc", db_path.display());

    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect(&db_url)
        .await
        .unwrap();

    sqlx::query("PRAGMA journal_mode=WAL")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS features (
            id INTEGER PRIMARY KEY,
            project_id INTEGER,
            title TEXT NOT NULL,
            type TEXT NOT NULL DEFAULT 'ws-session',
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS agent_sessions (
            id INTEGER PRIMARY KEY,
            feature_id INTEGER,
            agent_type TEXT,
            status TEXT DEFAULT 'running',
            started_at TEXT
        )",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS agent_messages (
            id INTEGER PRIMARY KEY,
            session_id INTEGER NOT NULL,
            role TEXT,
            content TEXT,
            tool_name TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )",
    )
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query("INSERT INTO features (id, title) VALUES (1, 'Test Feature')")
        .execute(&pool)
        .await
        .unwrap();

    drop(pool);

    let binary = std::env::current_exe()
        .unwrap()
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join("cadencr-service");

    if !binary.exists() {
        eprintln!(
            "Skipping test: cadencr-service binary not found at {:?}",
            binary
        );
        return;
    }

    let mut child = Command::new(&binary)
        .arg("--db-path")
        .arg(db_path.to_str().unwrap())
        .arg("mcp-serve")
        .arg("--agent-type")
        .arg("session")
        .arg("--feature-id")
        .arg("1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("failed to spawn cadencr-service");

    let mut stdin = child.stdin.take().unwrap();
    let stdout = child.stdout.take().unwrap();
    let mut reader = BufReader::new(stdout);

    let init_req = r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}"#;
    stdin.write_all(init_req.as_bytes()).await.unwrap();
    stdin.write_all(b"\n").await.unwrap();
    stdin.flush().await.unwrap();

    let mut line = String::new();
    reader.read_line(&mut line).await.unwrap();
    let init_resp: serde_json::Value = serde_json::from_str(&line).unwrap();
    assert_eq!(init_resp["result"]["serverInfo"]["name"], "cadencr-session");
    assert_eq!(init_resp["result"]["protocolVersion"], "2024-11-05");

    let initialized = r#"{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}"#;
    stdin.write_all(initialized.as_bytes()).await.unwrap();
    stdin.write_all(b"\n").await.unwrap();
    stdin.flush().await.unwrap();

    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    let tools_req = r#"{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}"#;
    stdin.write_all(tools_req.as_bytes()).await.unwrap();
    stdin.write_all(b"\n").await.unwrap();
    stdin.flush().await.unwrap();

    let mut tools_line = String::new();
    reader.read_line(&mut tools_line).await.unwrap();
    assert!(
        !tools_line.is_empty(),
        "tools/list response should not be empty"
    );

    let tools_resp: serde_json::Value = serde_json::from_str(&tools_line).unwrap();
    let tools = tools_resp["result"]["tools"].as_array().unwrap();

    let tool_names: Vec<&str> = tools.iter().map(|t| t["name"].as_str().unwrap()).collect();
    assert!(
        tool_names.contains(&"mark_agent_done"),
        "missing mark_agent_done"
    );
    assert!(
        tool_names.contains(&"list_conversations"),
        "missing list_conversations"
    );
    assert!(
        tool_names.contains(&"read_conversation"),
        "missing read_conversation"
    );

    drop(stdin);
    let _ = tokio::time::timeout(std::time::Duration::from_secs(5), child.wait()).await;
}
