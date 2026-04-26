-- Per-model thinking effort persistence.
--
-- Thinking effort is now stored:
--   * per conversation: `agent_sessions.thinking_effort` column (this migration adds it)
--   * per model (workspace default): `settings` row keyed `thinking_effort_model_<provider>_<modelId>`
--
-- Old per-agent-type keys (`thinking_effort_<agent>`) at any scope are removed; the
-- new model-keyed defaults are written by the WS effort.set handler instead.

ALTER TABLE agent_sessions ADD COLUMN thinking_effort TEXT NULL;

DELETE FROM settings WHERE key LIKE 'thinking_effort_%';
DELETE FROM project_settings WHERE key LIKE 'thinking_effort_%';
DELETE FROM feature_settings WHERE key LIKE 'thinking_effort_%';
