-- Remove the legacy `ws-feature` feature type and every column / table it owned.
-- ws-session is the only remaining feature type; nothing here touches its data.
--
-- Plan:
--   1. Delete every row tied to a `ws-feature` (or legacy `feature`) feature.
--   2. Drop ws-feature-only tables (plans, phases, workflow_queue, workflow_dependencies).
--   3. Normalize remaining ws-session feature status to active/archived.
--   4. Drop ws-feature-only columns from `features`.
--   5. Drop ws-feature-only model columns from `projects`.
--
-- All ws-feature features and their agent history are wiped — this is a personal
-- install and the user has signed off on the data loss.

-- ---------------------------------------------------------------------------
-- 1) Identify the dying feature IDs once. SQLite doesn't have CTE-as-table,
--    so we stash them in a temp table for the cascade below.
-- ---------------------------------------------------------------------------

CREATE TEMP TABLE _ws_feature_ids AS
SELECT id FROM features WHERE type IS NULL OR type IN ('ws-feature', 'feature');

CREATE TEMP TABLE _ws_feature_queue_ids AS
SELECT id FROM workflow_queue WHERE feature_id IN (SELECT id FROM _ws_feature_ids);

-- Dependent rows ----------------------------------------------------------

DELETE FROM workflow_dependencies
WHERE queue_item_id IN (SELECT id FROM _ws_feature_queue_ids)
OR depends_on_item_id IN (SELECT id FROM _ws_feature_queue_ids);

DELETE FROM workflow_queue
WHERE id IN (SELECT id FROM _ws_feature_queue_ids);

DELETE FROM phases
WHERE plan_id IN (
    SELECT id FROM plans WHERE feature_id IN (SELECT id FROM _ws_feature_ids)
);

DELETE FROM plans
WHERE feature_id IN (SELECT id FROM _ws_feature_ids);

DELETE FROM session_runtime_ids
WHERE session_id IN (
    SELECT id FROM agent_sessions WHERE feature_id IN (SELECT id FROM _ws_feature_ids)
);

DELETE FROM agent_messages
WHERE session_id IN (
    SELECT id FROM agent_sessions WHERE feature_id IN (SELECT id FROM _ws_feature_ids)
);

DELETE FROM agent_sessions
WHERE feature_id IN (SELECT id FROM _ws_feature_ids);

DELETE FROM feature_settings
WHERE feature_id IN (SELECT id FROM _ws_feature_ids);

DELETE FROM diff_comments
WHERE feature_id IN (SELECT id FROM _ws_feature_ids);

DELETE FROM diff_viewed_files
WHERE feature_id IN (SELECT id FROM _ws_feature_ids);

DELETE FROM custom_action_runs
WHERE feature_id IN (SELECT id FROM _ws_feature_ids);

DELETE FROM custom_action_variables
WHERE feature_id IN (SELECT id FROM _ws_feature_ids);

DELETE FROM custom_action_schedules
WHERE feature_id IN (SELECT id FROM _ws_feature_ids);

DELETE FROM features
WHERE id IN (SELECT id FROM _ws_feature_ids);

-- Some development databases predate strict FK handling and can already carry
-- orphaned legacy workflow rows and sessions. They are unreachable through
-- ws-session because their feature row is gone, so remove their children and
-- the orphan parent rows while leaving every session attached to a live feature
-- intact.
CREATE TEMP TABLE _orphan_agent_session_ids AS
SELECT s.id
FROM agent_sessions s
LEFT JOIN features f ON f.id = s.feature_id
WHERE f.id IS NULL;

CREATE TEMP TABLE _orphan_workflow_queue_ids AS
SELECT q.id
FROM workflow_queue q
LEFT JOIN features f ON f.id = q.feature_id
LEFT JOIN agent_sessions s ON s.id = q.agent_session_id
WHERE f.id IS NULL
    OR (q.agent_session_id IS NOT NULL AND s.id IS NULL)
    OR q.agent_session_id IN (SELECT id FROM _orphan_agent_session_ids);

DELETE FROM workflow_dependencies
WHERE queue_item_id IN (SELECT id FROM _orphan_workflow_queue_ids)
OR depends_on_item_id IN (SELECT id FROM _orphan_workflow_queue_ids);

DELETE FROM workflow_queue
WHERE id IN (SELECT id FROM _orphan_workflow_queue_ids);

DELETE FROM session_runtime_ids
WHERE session_id IN (SELECT id FROM _orphan_agent_session_ids);

DELETE FROM agent_messages
WHERE session_id IN (SELECT id FROM _orphan_agent_session_ids);

DELETE FROM agent_sessions
WHERE id IN (SELECT id FROM _orphan_agent_session_ids);

DROP TABLE _orphan_workflow_queue_ids;
DROP TABLE _orphan_agent_session_ids;
DROP TABLE _ws_feature_queue_ids;
DROP TABLE _ws_feature_ids;

-- ---------------------------------------------------------------------------
-- 2) Drop ws-feature-only tables.
--    Order matters: workflow_dependencies → workflow_queue (FK), phases → plans.
-- ---------------------------------------------------------------------------

DROP TABLE IF EXISTS workflow_dependencies;
DROP TABLE IF EXISTS workflow_queue;
DROP TABLE IF EXISTS phases;
DROP TABLE IF EXISTS plans;

-- Drop stale workspace/project/feature EAV settings that belonged to removed
-- ws-feature agents or removed QA/autonomy/parallel session controls.
DELETE FROM settings
WHERE key IN (
    'model_plan',
    'model_brainstorm',
    'model_execute',
    'model_risk',
    'model_review',
    'model_prd',
    'model_review-fixer',
    'model_retro',
    'model_qa',
    'model_workflow',
    'agent_runtime_plan',
    'agent_runtime_prd',
    'agent_runtime_execute',
    'agent_runtime_risk',
    'agent_runtime_review',
    'agent_runtime_review-fixer',
    'agent_runtime_retro',
    'agent_runtime_qa',
    'agent_autonomy',
    'parallel_execution',
    'qa_prompt'
);

DELETE FROM project_settings
WHERE key IN (
    'model_plan',
    'model_brainstorm',
    'model_execute',
    'model_risk',
    'model_review',
    'model_prd',
    'model_review-fixer',
    'model_retro',
    'model_qa',
    'model_workflow',
    'agent_runtime_plan',
    'agent_runtime_prd',
    'agent_runtime_execute',
    'agent_runtime_risk',
    'agent_runtime_review',
    'agent_runtime_review-fixer',
    'agent_runtime_retro',
    'agent_runtime_qa',
    'agent_autonomy',
    'parallel_execution',
    'qa_prompt'
);

DELETE FROM feature_settings
WHERE key IN (
    'model_plan',
    'model_brainstorm',
    'model_execute',
    'model_risk',
    'model_review',
    'model_prd',
    'model_review-fixer',
    'model_retro',
    'model_qa',
    'model_workflow',
    'agent_runtime_plan',
    'agent_runtime_prd',
    'agent_runtime_execute',
    'agent_runtime_risk',
    'agent_runtime_review',
    'agent_runtime_review-fixer',
    'agent_runtime_retro',
    'agent_runtime_qa',
    'agent_autonomy',
    'parallel_execution',
    'qa_prompt'
);

-- ---------------------------------------------------------------------------
-- 3) Normalize remaining ws-session feature status.
--    `status` used to mix workflow states (`draft`, etc.) with the archived
--    marker. Keep the archive flag, collapse every other value to `active`,
--    and enforce/normalize the two-value domain for future writes without rebuilding
--    `features` (rebuilds break live child FKs in real databases).
-- ---------------------------------------------------------------------------

UPDATE features
SET status = CASE WHEN status = 'archived' THEN 'archived' ELSE 'active' END;

CREATE TRIGGER IF NOT EXISTS features_status_insert_check
BEFORE INSERT ON features
FOR EACH ROW
WHEN NEW.status NOT IN ('active', 'archived', 'draft')
BEGIN
    SELECT RAISE(ABORT, 'features.status must be active or archived');
END;

CREATE TRIGGER IF NOT EXISTS features_status_insert_normalize
AFTER INSERT ON features
FOR EACH ROW
WHEN NEW.status = 'draft'
BEGIN
    UPDATE features SET status = 'active' WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS features_status_update_check
BEFORE UPDATE OF status ON features
FOR EACH ROW
WHEN NEW.status NOT IN ('active', 'archived', 'draft')
BEGIN
    SELECT RAISE(ABORT, 'features.status must be active or archived');
END;

CREATE TRIGGER IF NOT EXISTS features_status_update_normalize
AFTER UPDATE OF status ON features
FOR EACH ROW
WHEN NEW.status = 'draft'
BEGIN
    UPDATE features SET status = 'active' WHERE id = NEW.id;
END;

-- ---------------------------------------------------------------------------
-- 4) Drop ws-feature-only columns from `features`.
--    We intentionally do not rebuild the table here: existing ws-session rows
--    are still referenced by child tables (feature_settings, comments, custom
--    action rows, etc.), and dropping/recreating `features` inside sqlx's
--    migration transaction trips SQLite FK enforcement on real databases.
--    The service writes `type = 'ws-session'` and `status = 'active'`
--    explicitly for new rows, so the old defaults are harmless.
-- ---------------------------------------------------------------------------

ALTER TABLE features DROP COLUMN model_plan;
ALTER TABLE features DROP COLUMN model_brainstorm;
ALTER TABLE features DROP COLUMN model_execute;
ALTER TABLE features DROP COLUMN model_risk;
ALTER TABLE features DROP COLUMN model_review;
ALTER TABLE features DROP COLUMN model_prd;
ALTER TABLE features DROP COLUMN "model_review-fixer";
ALTER TABLE features DROP COLUMN model_retro;
ALTER TABLE features DROP COLUMN model_qa;
ALTER TABLE features DROP COLUMN prd;
ALTER TABLE features DROP COLUMN workflow_step;
ALTER TABLE features DROP COLUMN workflow_config;
ALTER TABLE features DROP COLUMN workflow_status;
ALTER TABLE features DROP COLUMN model_workflow;
ALTER TABLE features DROP COLUMN agent_runtime_plan;
ALTER TABLE features DROP COLUMN agent_runtime_prd;
ALTER TABLE features DROP COLUMN agent_runtime_execute;
ALTER TABLE features DROP COLUMN agent_runtime_risk;
ALTER TABLE features DROP COLUMN agent_runtime_review;
ALTER TABLE features DROP COLUMN "agent_runtime_review-fixer";
ALTER TABLE features DROP COLUMN agent_runtime_retro;
ALTER TABLE features DROP COLUMN agent_runtime_qa;
ALTER TABLE features DROP COLUMN agent_autonomy;
ALTER TABLE features DROP COLUMN parallel_execution;

-- ---------------------------------------------------------------------------
-- 5) Drop the matching ws-feature-only model columns from `projects`.
--    `projects` doesn't have a default we need to change, so plain DROP COLUMN
--    works.
-- ---------------------------------------------------------------------------

ALTER TABLE projects DROP COLUMN model_plan;
ALTER TABLE projects DROP COLUMN model_brainstorm;
ALTER TABLE projects DROP COLUMN model_execute;
ALTER TABLE projects DROP COLUMN model_risk;
ALTER TABLE projects DROP COLUMN model_review;
ALTER TABLE projects DROP COLUMN "model_review-fixer";
ALTER TABLE projects DROP COLUMN model_retro;
ALTER TABLE projects DROP COLUMN model_prd;
ALTER TABLE projects DROP COLUMN model_qa;
ALTER TABLE projects DROP COLUMN model_workflow;
ALTER TABLE projects DROP COLUMN agent_runtime_plan;
ALTER TABLE projects DROP COLUMN agent_runtime_prd;
ALTER TABLE projects DROP COLUMN agent_runtime_execute;
ALTER TABLE projects DROP COLUMN agent_runtime_risk;
ALTER TABLE projects DROP COLUMN agent_runtime_review;
ALTER TABLE projects DROP COLUMN "agent_runtime_review-fixer";
ALTER TABLE projects DROP COLUMN agent_runtime_retro;
ALTER TABLE projects DROP COLUMN agent_runtime_qa;
ALTER TABLE projects DROP COLUMN agent_autonomy;
ALTER TABLE projects DROP COLUMN parallel_execution;
ALTER TABLE projects DROP COLUMN qa_prompt;

-- ---------------------------------------------------------------------------
-- 6) Drop ws-feature-only columns from `agent_sessions`. Only the legacy
--    workflow's plan/prd agents ever wrote these; ws-session never used them.
--    `run_id` / `phase_id` referred to workflow_queue / phases rows we just
--    dropped, and `question_answer_result` was the ws-feature plan-mode dance.
-- ---------------------------------------------------------------------------

ALTER TABLE agent_sessions DROP COLUMN pending_plan_approval;
ALTER TABLE agent_sessions DROP COLUMN pending_prd_approval;
ALTER TABLE agent_sessions DROP COLUMN plan_approval_result;
ALTER TABLE agent_sessions DROP COLUMN prd_approval_result;
ALTER TABLE agent_sessions DROP COLUMN run_id;
ALTER TABLE agent_sessions DROP COLUMN phase_id;
ALTER TABLE agent_sessions DROP COLUMN question_answer_result;

-- The old composite index included workflow agent status; remaining feature
-- archive filtering is cheap enough without keeping the legacy name.
DROP INDEX IF EXISTS idx_agent_sessions_feature_status;
