use std::collections::HashMap;

use claude_agent_sdk_rs::mcp::McpServerConfig;

use cadence_service::domain::mcp::servers::{mcp_server_name, AgentType};

/// Verify mcp_server_name returns correct names for all agent types.
#[test]
fn test_mcp_server_name_all_types() {
    assert_eq!(mcp_server_name(AgentType::Plan), "cadence-plan");
    assert_eq!(mcp_server_name(AgentType::Prd), "cadence-prd");
    assert_eq!(mcp_server_name(AgentType::Execute), "cadence-execute");
    assert_eq!(mcp_server_name(AgentType::Qa), "cadence-qa");
    assert_eq!(mcp_server_name(AgentType::Review), "cadence-review");
    assert_eq!(mcp_server_name(AgentType::Risk), "cadence-risk");
    assert_eq!(mcp_server_name(AgentType::Retro), "cadence-retro");
    assert_eq!(mcp_server_name(AgentType::Session), "cadence-session");
}

/// Verify the MCP config JSON that gets passed to Claude CLI via --mcp-config
/// has the correct structure: {"mcpServers": {"cadence-<type>": {type: "stdio", ...}}}
#[test]
fn test_mcp_config_serializes_correctly_for_cli() {
    // Build a config manually (same as build_mcp_server_config but without env dependency)
    let server_name = "cadence-plan";
    let config = McpServerConfig::Stdio {
        command: "/usr/bin/cadence-service".to_string(),
        args: Some(vec![
            "--db-path".to_string(),
            "/tmp/test.db".to_string(),
            "mcp-serve".to_string(),
            "--agent-type".to_string(),
            "plan".to_string(),
            "--feature-id".to_string(),
            "42".to_string(),
        ]),
        env: Some(HashMap::from([(
            "CADENCE_DB_PATH".to_string(),
            "/tmp/test.db".to_string(),
        )])),
    };

    let mut servers = HashMap::new();
    servers.insert(server_name.to_string(), config);

    // This mirrors what the SDK does in to_cli_args()
    let wrapper = serde_json::json!({ "mcpServers": servers });
    let json_str = serde_json::to_string(&wrapper).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&json_str).unwrap();

    // Must have mcpServers wrapper
    assert!(
        parsed.get("mcpServers").is_some(),
        "missing mcpServers wrapper key"
    );

    let mcp_servers = parsed.get("mcpServers").unwrap();
    let plan_server = mcp_servers.get("cadence-plan").unwrap();

    // Must be stdio type
    assert_eq!(plan_server.get("type").unwrap(), "stdio");
    assert_eq!(
        plan_server.get("command").unwrap(),
        "/usr/bin/cadence-service"
    );

    // Args must include mcp-serve subcommand
    let args: Vec<String> =
        serde_json::from_value(plan_server.get("args").unwrap().clone()).unwrap();
    assert!(args.contains(&"mcp-serve".to_string()));
    assert!(args.contains(&"--agent-type".to_string()));
    assert!(args.contains(&"plan".to_string()));
    assert!(args.contains(&"--feature-id".to_string()));
    assert!(args.contains(&"42".to_string()));
    assert!(args.contains(&"--db-path".to_string()));
}

/// Verify that the MCP stdio server responds to initialize + tools/list.
///
/// This is a full integration test that spawns the cadence-service binary in
/// mcp-serve mode and verifies the handshake and tool listing works end-to-end.
#[tokio::test]
async fn test_mcp_stdio_server_responds_to_tools_list() {
    use std::process::Stdio;
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    use tokio::process::Command;

    // Create a temp DB with the required schema
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
    // Create minimal schema needed by MCP tools
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS features (
            id INTEGER PRIMARY KEY,
            project_id INTEGER,
            title TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'draft',
            type TEXT NOT NULL DEFAULT 'feature',
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS plans (
            id INTEGER PRIMARY KEY,
            feature_id INTEGER NOT NULL,
            content TEXT,
            status TEXT NOT NULL DEFAULT 'draft',
            summary TEXT,
            context TEXT,
            clarifications TEXT,
            completion_conditions TEXT,
            title TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS phases (
            id INTEGER PRIMARY KEY,
            plan_id INTEGER NOT NULL,
            step_number INTEGER NOT NULL,
            title TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            complexity INTEGER,
            commit_message TEXT,
            tasks TEXT,
            files TEXT,
            order_index INTEGER,
            prompt TEXT,
            phase_type TEXT,
            depends_on TEXT
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
            status TEXT DEFAULT 'running'
        )",
    )
    .execute(&pool)
    .await
    .unwrap();

    // Insert a test feature
    sqlx::query("INSERT INTO features (id, title, status) VALUES (1, 'Test Feature', 'draft')")
        .execute(&pool)
        .await
        .unwrap();

    drop(pool);

    // Find the built binary
    let binary = std::env::current_exe()
        .unwrap()
        .parent()
        .unwrap() // deps/
        .parent()
        .unwrap() // debug/
        .join("cadence-service");

    if !binary.exists() {
        eprintln!(
            "Skipping test: cadence-service binary not found at {:?}",
            binary
        );
        return;
    }

    // Spawn the MCP server subprocess
    let mut child = Command::new(&binary)
        .arg("--db-path")
        .arg(db_path.to_str().unwrap())
        .arg("mcp-serve")
        .arg("--agent-type")
        .arg("plan")
        .arg("--feature-id")
        .arg("1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("failed to spawn cadence-service");

    let mut stdin = child.stdin.take().unwrap();
    let stdout = child.stdout.take().unwrap();
    let mut reader = BufReader::new(stdout);

    // Send initialize request
    let init_req = r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}"#;
    stdin.write_all(init_req.as_bytes()).await.unwrap();
    stdin.write_all(b"\n").await.unwrap();
    stdin.flush().await.unwrap();

    // Read initialize response
    let mut line = String::new();
    reader.read_line(&mut line).await.unwrap();
    let init_resp: serde_json::Value = serde_json::from_str(&line).unwrap();
    assert_eq!(init_resp["result"]["serverInfo"]["name"], "cadence-plan");
    assert_eq!(init_resp["result"]["protocolVersion"], "2024-11-05");

    // Send initialized notification
    let initialized = r#"{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}"#;
    stdin.write_all(initialized.as_bytes()).await.unwrap();
    stdin.write_all(b"\n").await.unwrap();
    stdin.flush().await.unwrap();

    // Small delay for the notification to be processed
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    // Send tools/list request
    let tools_req = r#"{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}"#;
    stdin.write_all(tools_req.as_bytes()).await.unwrap();
    stdin.write_all(b"\n").await.unwrap();
    stdin.flush().await.unwrap();

    // Read tools/list response
    let mut tools_line = String::new();
    reader.read_line(&mut tools_line).await.unwrap();
    assert!(
        !tools_line.is_empty(),
        "tools/list response should not be empty"
    );

    let tools_resp: serde_json::Value = serde_json::from_str(&tools_line).unwrap();
    let tools = tools_resp["result"]["tools"].as_array().unwrap();

    // Plan server should have 10 tools
    assert_eq!(
        tools.len(),
        10,
        "plan server should expose 10 tools, got {}",
        tools.len()
    );

    // Verify key tools are present
    let tool_names: Vec<&str> = tools.iter().map(|t| t["name"].as_str().unwrap()).collect();
    assert!(tool_names.contains(&"read_plan"), "missing read_plan");
    assert!(tool_names.contains(&"create_phase"), "missing create_phase");
    assert!(tool_names.contains(&"update_plan"), "missing update_plan");
    assert!(tool_names.contains(&"show_plan"), "missing show_plan");
    assert!(
        tool_names.contains(&"finalize_plan"),
        "missing finalize_plan"
    );
    assert!(
        tool_names.contains(&"mark_agent_done"),
        "missing mark_agent_done"
    );
    assert!(tool_names.contains(&"list_phases"), "missing list_phases");
    assert!(tool_names.contains(&"read_phase"), "missing read_phase");
    assert!(tool_names.contains(&"update_phase"), "missing update_phase");
    assert!(tool_names.contains(&"remove_phase"), "missing remove_phase");

    // Close stdin to trigger server shutdown
    drop(stdin);
    let _ = tokio::time::timeout(std::time::Duration::from_secs(5), child.wait()).await;
}
