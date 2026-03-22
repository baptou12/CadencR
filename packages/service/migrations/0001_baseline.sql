-- Baseline migration: full schema as of Electron migration v48.
-- For existing databases this migration is marked as already-applied during seeding.
-- For fresh databases sqlx runs it to create the complete schema.

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    model_plan TEXT,
    model_brainstorm TEXT,
    model_execute TEXT,
    model_risk TEXT,
    model_review TEXT,
    model_session TEXT,
    model_qa TEXT,
    agent_autonomy TEXT,
    branch_prefix TEXT,
    qa_prompt TEXT,
    parallel_execution TEXT DEFAULT NULL,
    model_prd TEXT,
    "model_review-fixer" TEXT,
    model_retro TEXT
);

CREATE TABLE IF NOT EXISTS features (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    type TEXT NOT NULL DEFAULT 'feature',
    model_plan TEXT,
    model_brainstorm TEXT,
    model_execute TEXT,
    model_risk TEXT,
    model_review TEXT,
    model_session TEXT,
    model_qa TEXT,
    agent_autonomy TEXT,
    parallel_execution TEXT DEFAULT NULL,
    prd TEXT,
    model_prd TEXT,
    workflow_step TEXT,
    workflow_config TEXT,
    "model_review-fixer" TEXT,
    model_retro TEXT,
    workflow_status TEXT NOT NULL DEFAULT 'idle',
    FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    feature_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    raw_markdown TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    summary TEXT,
    context TEXT,
    clarifications TEXT,
    completion_conditions TEXT,
    FOREIGN KEY (feature_id) REFERENCES features(id)
);

CREATE TABLE IF NOT EXISTS phases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id INTEGER NOT NULL,
    step_number INTEGER NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    complexity INTEGER,
    commit_message TEXT,
    tasks TEXT,
    files TEXT,
    order_index INTEGER NOT NULL DEFAULT 0,
    prompt TEXT,
    implementation_notes TEXT,
    deviations TEXT,
    phase_type TEXT NOT NULL DEFAULT 'value',
    depends_on TEXT,
    FOREIGN KEY (plan_id) REFERENCES plans(id)
);

CREATE TABLE IF NOT EXISTS agent_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    feature_id INTEGER NOT NULL,
    agent_type TEXT NOT NULL,
    claude_session_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    started_at TEXT,
    ended_at TEXT,
    run_id INTEGER,
    phase_id INTEGER,
    subprocess_id TEXT,
    model TEXT,
    pending_questions TEXT,
    has_file_changes INTEGER DEFAULT 0,
    permission_mode TEXT DEFAULT 'bypassPermissions',
    pending_plan_approval TEXT,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    context_window INTEGER DEFAULT 200000,
    was_compacted INTEGER DEFAULT 0,
    pending_permission TEXT,
    draft_prompt TEXT DEFAULT NULL,
    plan_approval_result TEXT DEFAULT NULL,
    pending_prd_approval TEXT,
    prd_approval_result TEXT DEFAULT NULL,
    question_answer_result TEXT,
    FOREIGN KEY (feature_id) REFERENCES features(id)
);

CREATE TABLE IF NOT EXISTS agent_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    message_type TEXT NOT NULL DEFAULT 'text',
    tool_name TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    tool_use_id TEXT,
    parent_tool_use_id TEXT,
    model TEXT DEFAULT NULL,
    FOREIGN KEY (session_id) REFERENCES agent_sessions(id)
);

CREATE TABLE IF NOT EXISTS project_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id),
    UNIQUE(project_id, key)
);

CREATE TABLE IF NOT EXISTS feature_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    feature_id INTEGER NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    FOREIGN KEY (feature_id) REFERENCES features(id),
    UNIQUE(feature_id, key)
);

CREATE TABLE IF NOT EXISTS diff_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    feature_id INTEGER NOT NULL,
    file_path TEXT NOT NULL,
    line_number INTEGER NOT NULL,
    side TEXT NOT NULL CHECK (side IN ('old', 'new')),
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'resolved')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (feature_id) REFERENCES features(id)
);

CREATE TABLE IF NOT EXISTS prompt_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS diff_viewed_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    feature_id INTEGER NOT NULL,
    file_path TEXT NOT NULL,
    blob_sha TEXT NOT NULL,
    viewed_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (feature_id) REFERENCES features(id),
    UNIQUE(feature_id, file_path)
);

CREATE TABLE IF NOT EXISTS session_claude_ids (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES agent_sessions(id),
    claude_session_id TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS workflow_queue (
    id INTEGER PRIMARY KEY,
    feature_id INTEGER NOT NULL REFERENCES features(id),
    workflow_type TEXT NOT NULL DEFAULT 'feature_build'
        CHECK(workflow_type IN ('feature_build', 'code_review', 'design_improvement', 'bug_fix')),
    item_type TEXT NOT NULL CHECK(item_type IN ('plan', 'prd', 'execute', 'qa', 'review', 'risk', 'retro', 'investigate', 'design')),
    phase_id INTEGER REFERENCES phases(id),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending', 'blocked', 'ready', 'running', 'paused', 'completed', 'error', 'skipped')),
    order_index INTEGER NOT NULL,
    group_index INTEGER,
    config JSON,
    agent_session_id INTEGER REFERENCES agent_sessions(id),
    result JSON,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    started_at DATETIME,
    ended_at DATETIME,
    pid INTEGER,
    max_retries INTEGER NOT NULL DEFAULT 1,
    retry_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS workflow_dependencies (
    id INTEGER PRIMARY KEY,
    queue_item_id INTEGER NOT NULL REFERENCES workflow_queue(id) ON DELETE CASCADE,
    depends_on_item_id INTEGER NOT NULL REFERENCES workflow_queue(id) ON DELETE CASCADE,
    UNIQUE(queue_item_id, depends_on_item_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_agent_sessions_subprocess_id ON agent_sessions(subprocess_id);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_feature_status ON agent_sessions(feature_id, status);
CREATE INDEX IF NOT EXISTS idx_prompt_history_project ON prompt_history(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_session_claude_ids_session ON session_claude_ids(session_id);
CREATE INDEX IF NOT EXISTS idx_agent_messages_session ON agent_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_workflow_queue_feature ON workflow_queue(feature_id);
CREATE INDEX IF NOT EXISTS idx_workflow_queue_status ON workflow_queue(status);
CREATE INDEX IF NOT EXISTS idx_workflow_queue_type ON workflow_queue(workflow_type);
