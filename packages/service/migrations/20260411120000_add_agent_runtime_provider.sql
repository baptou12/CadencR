ALTER TABLE projects ADD COLUMN agent_runtime_plan TEXT;
ALTER TABLE projects ADD COLUMN agent_runtime_prd TEXT;
ALTER TABLE projects ADD COLUMN agent_runtime_execute TEXT;
ALTER TABLE projects ADD COLUMN agent_runtime_risk TEXT;
ALTER TABLE projects ADD COLUMN agent_runtime_review TEXT;
ALTER TABLE projects ADD COLUMN "agent_runtime_review-fixer" TEXT;
ALTER TABLE projects ADD COLUMN agent_runtime_session TEXT;
ALTER TABLE projects ADD COLUMN agent_runtime_qa TEXT;
ALTER TABLE projects ADD COLUMN agent_runtime_retro TEXT;

ALTER TABLE features ADD COLUMN agent_runtime_plan TEXT;
ALTER TABLE features ADD COLUMN agent_runtime_prd TEXT;
ALTER TABLE features ADD COLUMN agent_runtime_execute TEXT;
ALTER TABLE features ADD COLUMN agent_runtime_risk TEXT;
ALTER TABLE features ADD COLUMN agent_runtime_review TEXT;
ALTER TABLE features ADD COLUMN "agent_runtime_review-fixer" TEXT;
ALTER TABLE features ADD COLUMN agent_runtime_session TEXT;
ALTER TABLE features ADD COLUMN agent_runtime_qa TEXT;
ALTER TABLE features ADD COLUMN agent_runtime_retro TEXT;

ALTER TABLE agent_sessions ADD COLUMN runtime_provider TEXT;
ALTER TABLE agent_sessions ADD COLUMN runtime_session_id TEXT;
