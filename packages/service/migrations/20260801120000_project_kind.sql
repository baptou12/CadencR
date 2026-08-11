-- Distinguish the projects a user added from the ones Cadencr creates to give
-- an agent a working directory that isn't a repository.
--
-- The first of those is the per-theme workspace: editing a theme opens a normal
-- conversation whose cwd is the theme's own folder, which needs a real project
-- row for the runtime to resolve — but must never show up in the sidebar, the
-- unified agents grid or the MCP workspace tools.
ALTER TABLE projects ADD COLUMN kind TEXT NOT NULL DEFAULT 'user';
